import { contentTypeForPlatform } from "@/lib/content-types";
import type { ScheduleJobItemRow, ScheduleJobRow } from "@/lib/schedule-jobs/types";
import { createAdminClient } from "@/lib/supabase/admin";
import type { SocialPlatform } from "@/lib/types";
import {
  buildExcludedCountByLocalDate,
  buildWarmupRecalculatePlan,
} from "@/lib/warmup-diagnostics";

const ACTIVE_POST_STATUSES = ["pending", "processing", "retrying"];

export async function executeWarmupRecalculate(jobId: string) {
  const supabase = createAdminClient();
  const step = (name: string) => console.info("[warmup-recalculate]", { jobId, step: name });

  const { data: job, error } = await supabase
    .from("schedule_jobs")
    .select("id, schedule_mode, upload_batch_id, platform, account_id, tiktok_account_id")
    .eq("id", jobId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!job) throw new Error("job_not_found");
  step("load_job");

  const row = job as ScheduleJobRow;
  if (row.schedule_mode !== "warmup") throw new Error("job_not_warmup");
  if (!row.upload_batch_id) throw new Error("job_missing_batch");

  const platform = (row.platform === "tiktok" ? "tiktok" : "instagram") as SocialPlatform;
  const accountId = platform === "tiktok" ? row.tiktok_account_id : row.account_id;
  if (!accountId) throw new Error("job_missing_account");

  const { data: posts, error: postsError } = await supabase
    .from("scheduled_posts")
    .select("id, scheduled_at, status")
    .eq("upload_batch_id", row.upload_batch_id)
    .in("status", ACTIVE_POST_STATUSES)
    .order("scheduled_at", { ascending: true });
  if (postsError) throw new Error(postsError.message);
  step("load_pending_posts");

  const pendingPosts = posts ?? [];
  if (!pendingPosts.length) {
    return { ok: true as const, updated: 0, before: [], after: [] };
  }

  const { data: items } = await supabase
    .from("schedule_job_items")
    .select("id, destinations, sort_order, scheduled_at")
    .eq("schedule_job_id", jobId)
    .order("sort_order", { ascending: true });
  step("load_job_items");

  const jobItems = (items ?? []) as ScheduleJobItemRow[];
  const now = new Date();
  const excludedCountByLocalDate = buildExcludedCountByLocalDate(
    pendingPosts.map((post) => post.scheduled_at as string),
  );
  const contentType = contentTypeForPlatform(platform);

  const { context: warmupContext, plan, planningMeta } = await buildWarmupRecalculatePlan({
    supabase,
    accountId,
    platform,
    contentType,
    pendingCount: pendingPosts.length,
    excludedCountByLocalDate,
    now,
    includeCapacityDiagnostics: false,
  });
  step("build_plan");

  if (plan.schedule.length < pendingPosts.length) {
    throw new Error("insufficient_warmup_slots");
  }

  const before: Array<{ postId: string; scheduledAt: string }> = [];
  const after: Array<{ postId: string; scheduledAt: string }> = [];

  for (let index = 0; index < pendingPosts.length; index++) {
    const post = pendingPosts[index]!;
    const nextAt = plan.schedule[index]!.toISOString();
    before.push({ postId: post.id as string, scheduledAt: post.scheduled_at as string });
    after.push({ postId: post.id as string, scheduledAt: nextAt });
  }

  const nowIso = now.toISOString();
  for (let offset = 0; offset < pendingPosts.length; offset += 10) {
    const chunk = pendingPosts.slice(offset, offset + 10);
    await Promise.all(
      chunk.map((post, chunkIndex) => {
        const index = offset + chunkIndex;
        const nextAt = plan.schedule[index]!.toISOString();
        return supabase
          .from("scheduled_posts")
          .update({ scheduled_at: nextAt, updated_at: nowIso })
          .eq("id", post.id)
          .in("status", ACTIVE_POST_STATUSES);
      }),
    );
  }
  step("update_posts");

  step("update_job_items");
  for (let offset = 0; offset < jobItems.length; offset += 10) {
    const chunk = jobItems.slice(offset, offset + 10);
    await Promise.all(
      chunk.map((item, chunkIndex) => {
        const index = offset + chunkIndex;
        const nextAt = plan.schedule[index]?.toISOString();
        if (!nextAt || !item.destinations?.length) return Promise.resolve();
        const destinations = item.destinations.map((dest) => ({
          ...dest,
          scheduled_at: nextAt,
        }));
        return supabase
          .from("schedule_job_items")
          .update({
            destinations,
            scheduled_at: nextAt,
            updated_at: nowIso,
          })
          .eq("id", item.id);
      }),
    );
  }
  step("update_job_items");

  step("done");
  return {
    ok: true as const,
    warmupStartDate: warmupContext.warmupStartDate,
    updated: pendingPosts.length,
    planningMeta,
    before: before.slice(0, 7),
    after: after.slice(0, 7),
  };
}
