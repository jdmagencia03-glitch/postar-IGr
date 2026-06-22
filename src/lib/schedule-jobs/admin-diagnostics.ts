import type { SupabaseClient } from "@supabase/supabase-js";
import { WARMUP_PATTERN } from "@/lib/account-warmup";
import { buildScheduleJobTiming } from "@/lib/schedule-jobs/timing";
import type { ScheduleJobRow } from "@/lib/schedule-jobs/types";

export type ScheduleJobDiagnostics = {
  ok: true;
  batchId: string | null;
  jobId: string | null;
  scheduleMode: string | null;
  warmupPattern: string | null;
  scheduleSummary: string | null;
  skippedPastSlots: Array<{ date: string; time: string; reason: "past_time" }>;
  plannedPosts: Array<{
    dayIndex: number;
    scheduledAt: string;
    slot: string;
    slotSource: "warmup_fixed";
  }>;
  jobs: Array<{
    id: string;
    status: string;
    phase: string;
    totalItems: number;
    postsSaved: number;
    failed: number;
    createdAt: string;
    updatedAt: string;
    timing: ReturnType<typeof buildScheduleJobTiming>;
  }>;
  jobItems: Array<{ fileId: string; status: string; scheduledAt: string | null }>;
  createdPosts: Array<{
    id: string;
    fileId: string | null;
    scheduledAt: string;
    status: string;
    scheduleJobId: string | null;
  }>;
  duplicates: Array<{ scheduledAt: string; count: number }>;
  missingPosts: Array<{ fileId: string; reason: string }>;
  recommendedAction:
    | "resume"
    | "completed"
    | "safe_to_retry"
    | "manual_review"
    | "wait";
};

export async function buildScheduleJobDiagnostics(
  supabase: SupabaseClient,
  ownerId: string,
  batchId?: string,
  jobId?: string,
): Promise<ScheduleJobDiagnostics | { ok: false; error: string }> {
  let resolvedBatchId = batchId ?? null;
  let resolvedJobId = jobId ?? null;

  if (jobId && !batchId) {
    const { data: jobById } = await supabase
      .from("schedule_jobs")
      .select("id, upload_batch_id, owner_id")
      .eq("id", jobId)
      .eq("owner_id", ownerId)
      .maybeSingle();
    if (!jobById) return { ok: false, error: "job_not_found" };
    resolvedBatchId = (jobById.upload_batch_id as string | null) ?? null;
    resolvedJobId = jobById.id as string;
  }

  if (!resolvedBatchId && !resolvedJobId) {
    return { ok: false, error: "batch_or_job_required" };
  }

  if (resolvedBatchId) {
    const { data: batch } = await supabase
      .from("upload_batches")
      .select("id, owner_id")
      .eq("id", resolvedBatchId)
      .eq("owner_id", ownerId)
      .maybeSingle();

    if (!batch) return { ok: false, error: "batch_not_found" };
  }

  let jobsQuery = supabase.from("schedule_jobs").select("*").eq("owner_id", ownerId);
  if (resolvedJobId) {
    jobsQuery = jobsQuery.eq("id", resolvedJobId);
  } else if (resolvedBatchId) {
    jobsQuery = jobsQuery.eq("upload_batch_id", resolvedBatchId);
  }
  const { data: jobs } = await jobsQuery.order("created_at", { ascending: false });

  const { data: jobItems } = await supabase
    .from("schedule_job_items")
    .select("id, upload_file_id, status, scheduled_at, schedule_job_id")
    .in(
      "schedule_job_id",
      (jobs ?? []).map((job) => job.id),
    );

  const { data: scheduledPosts } = resolvedBatchId
    ? await supabase
        .from("scheduled_posts")
        .select("id, upload_file_id, scheduled_at, status, schedule_job_id")
        .eq("upload_batch_id", resolvedBatchId)
    : { data: [] };

  const jobItemRows =
    jobItems?.map((item) => ({
      fileId: item.upload_file_id as string,
      status: item.status as string,
      scheduledAt: (item.scheduled_at as string | null) ?? null,
    })) ?? [];

  const createdPosts =
    scheduledPosts?.map((post) => ({
      id: post.id as string,
      fileId: (post.upload_file_id as string | null) ?? null,
      scheduledAt: post.scheduled_at as string,
      status: post.status as string,
      scheduleJobId: (post.schedule_job_id as string | null) ?? null,
    })) ?? [];

  const slotCounts = new Map<string, number>();
  for (const post of createdPosts) {
    const key = post.scheduledAt;
    slotCounts.set(key, (slotCounts.get(key) ?? 0) + 1);
  }
  const duplicates = [...slotCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([scheduledAt, count]) => ({ scheduledAt, count }));

  const createdFileIds = new Set(
    createdPosts.map((post) => post.fileId).filter(Boolean) as string[],
  );
  const missingPosts = jobItemRows
    .filter((item) => item.status !== "created" && item.status !== "skipped_duplicate")
    .filter((item) => !createdFileIds.has(item.fileId))
    .map((item) => ({
      fileId: item.fileId,
      reason: `item_status_${item.status}`,
    }));

  const latestJob = jobs?.[0] as ScheduleJobRow | undefined;
  const schedulePlan = latestJob?.config?.schedule_plan;

  let recommendedAction: ScheduleJobDiagnostics["recommendedAction"] = "wait";

  if (!jobs?.length) {
    recommendedAction = "safe_to_retry";
  } else if (latestJob?.status === "completed") {
    recommendedAction = "completed";
  } else if (
    latestJob?.status === "partial_failed" ||
    latestJob?.status === "failed"
  ) {
    recommendedAction = "resume";
  } else if (duplicates.length) {
    recommendedAction = "manual_review";
  } else if (missingPosts.length) {
    recommendedAction = "resume";
  }

  return {
    ok: true,
    batchId: resolvedBatchId,
    jobId: resolvedJobId ?? latestJob?.id ?? null,
    scheduleMode: latestJob?.schedule_mode ?? null,
    warmupPattern:
      schedulePlan?.warmupPattern ??
      (latestJob?.schedule_mode === "warmup" ? WARMUP_PATTERN : null),
    scheduleSummary: latestJob?.schedule_summary ?? null,
    skippedPastSlots: schedulePlan?.skippedPastSlots ?? [],
    plannedPosts: schedulePlan?.plannedPosts ?? [],
    jobs:
      jobs?.map((job) => {
        const row = job as ScheduleJobRow;
        return {
          id: row.id,
          status: row.status,
          phase: row.status,
          totalItems: row.total_items,
          postsSaved: row.completed_items,
          failed: row.failed_items,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          timing: buildScheduleJobTiming(row),
        };
      }) ?? [],
    jobItems: jobItemRows,
    createdPosts,
    duplicates,
    missingPosts,
    recommendedAction,
  };
}
