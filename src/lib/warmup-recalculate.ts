import { contentTypeForPlatform } from "@/lib/content-types";
import type { ScheduleJobItemRow, ScheduleJobRow } from "@/lib/schedule-jobs/types";
import { createAdminClient } from "@/lib/supabase/admin";
import type { SocialPlatform } from "@/lib/types";
import { buildWarmupRecalculatePlan } from "@/lib/warmup-diagnostics";

const ACTIVE_POST_STATUSES = ["pending", "processing", "retrying"];

export async function executeWarmupRecalculate(jobId: string) {
  const supabase = createAdminClient();
  const { data: job, error } = await supabase
    .from("schedule_jobs")
    .select("*")
    .eq("id", jobId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!job) throw new Error("job_not_found");

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

  const pendingPosts = posts ?? [];
  if (!pendingPosts.length) {
    return { ok: true as const, updated: 0, before: [], after: [] };
  }

  const { data: items } = await supabase
    .from("schedule_job_items")
    .select("*")
    .eq("schedule_job_id", jobId)
    .order("sort_order", { ascending: true });

  const jobItems = (items ?? []) as ScheduleJobItemRow[];
  const now = new Date();
  const excludePostIds = pendingPosts.map((post) => post.id as string);
  const contentType = contentTypeForPlatform(platform);

  const { context: warmupContext, plan, planningMeta } = await buildWarmupRecalculatePlan({
    supabase,
    accountId,
    platform,
    contentType,
    pendingCount: pendingPosts.length,
    excludePostIds,
    now,
    includeCapacityDiagnostics: false,
  });

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
  for (const [index, post] of pendingPosts.entries()) {
    const nextAt = plan.schedule[index]!.toISOString();
    const { error: updateError } = await supabase
      .from("scheduled_posts")
      .update({ scheduled_at: nextAt, updated_at: nowIso })
      .eq("id", post.id)
      .in("status", ACTIVE_POST_STATUSES);
    if (updateError) throw new Error(updateError.message);
  }

  for (const [index, item] of jobItems.entries()) {
    const nextAt = plan.schedule[index]?.toISOString();
    if (!nextAt || !item.destinations?.length) continue;
    const destinations = item.destinations.map((dest) => ({
      ...dest,
      scheduled_at: nextAt,
    }));
    const { error: itemError } = await supabase
      .from("schedule_job_items")
      .update({
        destinations,
        scheduled_at: nextAt,
        updated_at: nowIso,
      })
      .eq("id", item.id);
    if (itemError) throw new Error(itemError.message);
  }

  await supabase
    .from("schedule_jobs")
    .update({
      config: {
        ...row.config,
        schedule_plan: {
          ...row.config?.schedule_plan,
          warmupStartDate: warmupContext.warmupStartDate,
          nowUsedForPlanning: now.toISOString(),
          plannedPosts: plan.plannedPosts,
          skippedPastSlots: plan.skippedPastSlots,
          planningMeta,
        },
      },
      updated_at: nowIso,
    })
    .eq("id", jobId);

  return {
    ok: true as const,
    warmupStartDate: warmupContext.warmupStartDate,
    updated: pendingPosts.length,
    planningMeta,
    before: before.slice(0, 7),
    after: after.slice(0, 7),
  };
}
