import { waitUntil } from "@vercel/functions";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createWorkerId, kickScheduleJobWorker } from "@/lib/schedule-jobs/worker";
import { isJobStale, isWorkerActive } from "@/lib/schedule-jobs/state";
import type { ScheduleJobRow } from "@/lib/schedule-jobs/types";

const BACKGROUND_KICK_STALE_MS = 12_000;

export function shouldBackgroundKick(job: ScheduleJobRow) {
  if (job.status !== "queued" && job.status !== "processing") return false;
  if (isWorkerActive(job)) return false;
  const staleMs = Date.now() - new Date(job.updated_at).getTime();
  return staleMs >= BACKGROUND_KICK_STALE_MS;
}

export function scheduleBackgroundKick(
  supabase: SupabaseClient,
  ownerId: string,
  jobId: string,
  prefix = "bg",
) {
  waitUntil(
    kickScheduleJobWorker(supabase, ownerId, jobId, createWorkerId(prefix)).catch(() => undefined),
  );
}

export function isJobPausedNeedsAction(job: ScheduleJobRow) {
  return isJobStale(job) && !isWorkerActive(job);
}
