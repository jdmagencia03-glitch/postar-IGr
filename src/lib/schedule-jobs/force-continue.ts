import type { SupabaseClient } from "@supabase/supabase-js";
import { drainScheduleJobQueue } from "@/lib/schedule-jobs/queue/drain";
import { QUEUE_CRON_MAX_MS } from "@/lib/schedule-jobs/queue/constants";
import { repairScheduleJob } from "@/lib/schedule-jobs/queue/repair";
import { finalizeJobStatusFromDb, getScheduleJobHeader } from "@/lib/schedule-jobs/repository";
import type { ScheduleJobRow } from "@/lib/schedule-jobs/types";

export type ForceContinueResult = {
  repair: Awaited<ReturnType<typeof repairScheduleJob>>;
  drain: Awaited<ReturnType<typeof drainScheduleJobQueue>>;
  job: ScheduleJobRow;
};

export async function forceContinueScheduleJob(
  supabase: SupabaseClient,
  ownerId: string,
  jobId: string,
  options?: { maxMs?: number },
): Promise<ForceContinueResult> {
  const job = await getScheduleJobHeader(supabase, ownerId, jobId);
  if (!job) throw new Error("Job não encontrado");

  const repair = await repairScheduleJob(supabase, jobId);
  const drain = await drainScheduleJobQueue(supabase, {
    workerPrefix: "force",
    maxMs: options?.maxMs ?? QUEUE_CRON_MAX_MS,
  });

  let refreshed = await getScheduleJobHeader(supabase, ownerId, jobId);
  if (!refreshed) throw new Error("Job não encontrado");

  if (refreshed.status === "processing" || refreshed.status === "queued") {
    refreshed = await finalizeJobStatusFromDb(supabase, refreshed);
  }

  return { repair, drain, job: refreshed };
}
