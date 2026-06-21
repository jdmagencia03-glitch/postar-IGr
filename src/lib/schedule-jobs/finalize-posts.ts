import type { SupabaseClient } from "@supabase/supabase-js";
import {
  finalizeJobStatusFromDb,
  getScheduleJobHeader,
  loadInsertPendingItems,
} from "@/lib/schedule-jobs/repository";
import { processInsertChunkForItems } from "@/lib/schedule-jobs/phases/save-posts";
import type { ScheduleJobRow } from "@/lib/schedule-jobs/types";
import { repairScheduleJob } from "@/lib/schedule-jobs/queue/repair";
import { resetGhostCompletedJobItems } from "@/lib/schedule-jobs/reset-ghost-items";

const FINALIZE_CHUNK = 100;
const DEFAULT_MAX_MS = 25_000;

export type FinalizePostsResult = {
  savedThisRun: number;
  batches: number;
  job: ScheduleJobRow;
  timedOut: boolean;
};

export async function finalizePostsForJob(
  supabase: SupabaseClient,
  ownerId: string,
  jobId: string,
  options?: { maxMs?: number },
): Promise<FinalizePostsResult> {
  const maxMs = options?.maxMs ?? DEFAULT_MAX_MS;
  const deadline = Date.now() + maxMs;

  let job = await getScheduleJobHeader(supabase, ownerId, jobId);
  if (!job) throw new Error("Job não encontrado");

  await repairScheduleJob(supabase, jobId);
  const resetGhost = await resetGhostCompletedJobItems(supabase, jobId);
  job = (await getScheduleJobHeader(supabase, ownerId, jobId))!;
  if (resetGhost > 0) {
    job = await finalizeJobStatusFromDb(supabase, job);
  }

  let savedThisRun = 0;
  let batches = 0;
  let timedOut = false;

  while (Date.now() < deadline) {
    const pending = await loadInsertPendingItems(supabase, jobId, FINALIZE_CHUNK);
    if (!pending.length) break;

    const itemIds = pending.map((item) => item.id);
    const before = job.completed_items;

    await processInsertChunkForItems(supabase, ownerId, job, itemIds);
    job = await finalizeJobStatusFromDb(supabase, job);

    const delta = Math.max(0, job.completed_items - before);
    savedThisRun += delta;
    batches += 1;

    if (delta === 0 && pending.length > 0) {
      // Evita loop infinito se nada foi salvo neste chunk
      break;
    }
    if (delta === 0) break;
    if (Date.now() >= deadline) {
      timedOut = true;
      break;
    }
  }

  if (Date.now() >= deadline && batches > 0) {
    timedOut = true;
  }

  return { savedThisRun, batches, job, timedOut };
}
