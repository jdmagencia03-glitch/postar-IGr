import fs from "node:fs";
import path from "node:path";
import { contentTypeForPlatform } from "../src/lib/content-types.ts";
import { buildJobStatusReadOnly } from "../src/lib/schedule-jobs/repository.ts";
import type { ScheduleJobItemRow } from "../src/lib/schedule-jobs/types.ts";
import { createAdminClient } from "../src/lib/supabase/admin.ts";
import type { SocialPlatform } from "../src/lib/types.ts";
import { buildWarmupRecalculatePlan } from "../src/lib/warmup-diagnostics.ts";

function loadEnv(filePath: string) {
  const env: Record<string, string> = {};
  if (!fs.existsSync(filePath)) return env;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 0) continue;
    let v = t.slice(i + 1);
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    env[t.slice(0, i)] = v;
  }
  return env;
}

const env = {
  ...loadEnv(path.join(process.cwd(), ".env.local")),
  ...loadEnv(path.join(process.cwd(), ".env.vercel.prod")),
  ...process.env,
};

for (const [key, value] of Object.entries(env)) {
  if (value && !process.env[key]) process.env[key] = value;
}

const jobId = process.argv[2] ?? "f4ac3a3b-885b-44b5-ba18-c65a78f9723b";
const mode = process.argv[3] ?? "all";

const supabase = createAdminClient();
const ACTIVE_POST_STATUSES = ["pending", "processing", "retrying"];

async function fetchStatus() {
  const { data: job, error } = await supabase
    .from("schedule_jobs")
    .select("*")
    .eq("id", jobId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!job) throw new Error("job_not_found");
  return buildJobStatusReadOnly(supabase, job);
}

async function recalculate() {
  const { data: job, error } = await supabase
    .from("schedule_jobs")
    .select("*")
    .eq("id", jobId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!job) throw new Error("job_not_found");
  if (job.schedule_mode !== "warmup") throw new Error("job_not_warmup");
  if (!job.upload_batch_id) throw new Error("job_missing_batch");

  const platform = (job.platform === "tiktok" ? "tiktok" : "instagram") as SocialPlatform;
  const accountId =
    platform === "tiktok" ? job.tiktok_account_id : job.account_id;
  if (!accountId) throw new Error("job_missing_account");

  const { data: posts, error: postsError } = await supabase
    .from("scheduled_posts")
    .select("id, scheduled_at, status")
    .eq("upload_batch_id", job.upload_batch_id)
    .in("status", ACTIVE_POST_STATUSES)
    .order("scheduled_at", { ascending: true });
  if (postsError) throw new Error(postsError.message);

  const pendingPosts = posts ?? [];
  if (!pendingPosts.length) {
    return { ok: true, updated: 0, before: [], after: [] };
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

    const { error: updateError } = await supabase
      .from("scheduled_posts")
      .update({ scheduled_at: nextAt, updated_at: now.toISOString() })
      .eq("id", post.id)
      .in("status", ACTIVE_POST_STATUSES);
    if (updateError) throw new Error(updateError.message);
  }

  for (let index = 0; index < jobItems.length; index++) {
    const item = jobItems[index]!;
    const nextAt = plan.schedule[index]?.toISOString();
    if (!nextAt || !item.destinations?.length) continue;

    const destinations = item.destinations.map((dest) => ({
      ...dest,
      scheduled_at: nextAt,
    }));

    await supabase
      .from("schedule_job_items")
      .update({
        destinations,
        scheduled_at: nextAt,
        updated_at: now.toISOString(),
      })
      .eq("id", item.id);
  }

  await supabase
    .from("schedule_jobs")
    .update({
      config: {
        ...job.config,
        schedule_plan: {
          ...job.config?.schedule_plan,
          warmupStartDate: warmupContext.warmupStartDate,
          nowUsedForPlanning: now.toISOString(),
          plannedPosts: plan.plannedPosts,
          skippedPastSlots: plan.skippedPastSlots,
          planningMeta,
        },
      },
      updated_at: now.toISOString(),
    })
    .eq("id", jobId);

  return {
    ok: true,
    warmupStartDate: warmupContext.warmupStartDate,
    updated: pendingPosts.length,
    planningMeta,
    before: before.slice(0, 7),
    after: after.slice(0, 7),
    firstAfter: after[0],
  };
}

if (mode === "status" || mode === "all") {
  const statusBefore = await fetchStatus();
  console.log("=== STATUS ===");
  console.log(
    JSON.stringify(
      {
        status: statusBefore.status,
        postsSaved: statusBefore.postsSaved,
        postsInCalendar: statusBefore.postsInCalendar,
        failed: statusBefore.failed,
        effectiveFirstScheduledDate: statusBefore.plannedPosts?.[0]?.scheduledAt,
        plannedPostsSample: statusBefore.plannedPosts?.slice(0, 7),
      },
      null,
      2,
    ),
  );
}

if (mode === "recalculate" || mode === "all") {
  if (mode === "all") {
    console.log("\n=== RECALCULATE ===");
  }
  const result = await recalculate();
  console.log(JSON.stringify(result, null, 2));
}

if (mode === "after" || mode === "all") {
  const statusAfter = await fetchStatus();
  console.log("\n=== STATUS AFTER ===");
  console.log(
    JSON.stringify(
      {
        status: statusAfter.status,
        postsSaved: statusAfter.postsSaved,
        postsInCalendar: statusAfter.postsInCalendar,
        failed: statusAfter.failed,
        plannedPostsSample: statusAfter.plannedPosts?.slice(0, 7),
      },
      null,
      2,
    ),
  );

  const batchId = statusAfter.batchId;
  if (batchId) {
    const { count } = await supabase
      .from("scheduled_posts")
      .select("id", { count: "exact", head: true })
      .eq("upload_batch_id", batchId);
    console.log("\n=== POST COUNT (batch) ===", count);
  }
}
