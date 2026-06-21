import type { SupabaseClient } from "@supabase/supabase-js";
import {
  SCHEDULE_JOB_CRON_CHUNKS_PER_JOB,
} from "@/lib/schedule-jobs/constants";
import { checkScheduleJobsSchema } from "@/lib/schedule-jobs/health";
import {
  createWorkerId,
  enqueueScheduleJobWithLock,
  findJobsForWorker,
  processScheduleJobWithLock,
} from "@/lib/schedule-jobs/worker";

export type CronProcessResult = {
  jobId: string;
  ownerId: string;
  acquired: boolean;
  chunkProcessed: boolean;
  status?: string;
  processedItems?: number;
  completedItems?: number;
  error?: string;
};

export async function processActiveScheduleJobs(
  supabase: SupabaseClient,
  options?: { maxJobs?: number; chunksPerJob?: number; workerPrefix?: string },
): Promise<{ results: CronProcessResult[]; schemaOk: boolean }> {
  const maxJobs = options?.maxJobs ?? 1;
  const chunksPerJob = options?.chunksPerJob ?? SCHEDULE_JOB_CRON_CHUNKS_PER_JOB;
  const workerPrefix = options?.workerPrefix ?? "cron";

  const schema = await checkScheduleJobsSchema(supabase);
  if (!schema.tableExists || !schema.ok) {
    throw new Error(schema.error ?? "schedule_jobs schema incomplete");
  }

  const candidates = await findJobsForWorker(supabase, maxJobs, {
    workerColumnsReady: schema.workerColumnsReady,
  });

  if (!candidates.length) {
    return { results: [], schemaOk: true };
  }

  const results: CronProcessResult[] = [];

  for (const candidate of candidates) {
    const workerId = createWorkerId(workerPrefix);
    const entry: CronProcessResult = {
      jobId: candidate.id,
      ownerId: candidate.ownerId,
      acquired: false,
      chunkProcessed: false,
    };

    try {
      const result = await processScheduleJobWithLock(
        supabase,
        candidate.ownerId,
        candidate.id,
        {
          workerId,
          maxChunks: chunksPerJob,
          lockless: !schema.workerColumnsReady,
        },
      );
      entry.acquired = result.acquired;
      entry.chunkProcessed = result.acquired;
      if (result.job) {
        entry.status = result.job.status;
        entry.processedItems = result.job.processed_items;
        entry.completedItems = result.job.completed_items;
      }
    } catch (err) {
      entry.error = err instanceof Error ? err.message : "Falha ao avançar job";
    }

    results.push(entry);
  }

  return { results, schemaOk: true };
}

export type CronEnqueueResult = {
  jobId: string;
  ownerId: string;
  accepted: boolean;
  status?: string;
  processedItems?: number;
  completedItems?: number;
  error?: string;
};

/** Enfileira chunks em background — resposta rápida para cron externo (ex.: timeout 30s). */
export async function enqueueActiveScheduleJobs(
  supabase: SupabaseClient,
  options?: { maxJobs?: number; chunksPerJob?: number; workerPrefix?: string },
): Promise<{ results: CronEnqueueResult[]; schemaOk: boolean }> {
  const maxJobs = options?.maxJobs ?? 1;
  const chunksPerJob = options?.chunksPerJob ?? SCHEDULE_JOB_CRON_CHUNKS_PER_JOB;
  const workerPrefix = options?.workerPrefix ?? "cron";

  const schema = await checkScheduleJobsSchema(supabase);
  if (!schema.tableExists || !schema.ok) {
    throw new Error(schema.error ?? "schedule_jobs schema incomplete");
  }

  const candidates = await findJobsForWorker(supabase, maxJobs, {
    workerColumnsReady: schema.workerColumnsReady,
  });

  if (!candidates.length) {
    return { results: [], schemaOk: true };
  }

  const results: CronEnqueueResult[] = [];

  for (const candidate of candidates) {
    const workerId = createWorkerId(workerPrefix);
    const entry: CronEnqueueResult = {
      jobId: candidate.id,
      ownerId: candidate.ownerId,
      accepted: false,
    };

    try {
      const result = await enqueueScheduleJobWithLock(
        supabase,
        candidate.ownerId,
        candidate.id,
        {
          workerId,
          maxChunks: chunksPerJob,
          lockless: !schema.workerColumnsReady,
        },
      );
      entry.accepted = result.accepted;
      if (result.job) {
        entry.status = result.job.status;
        entry.processedItems = result.job.processed_items;
        entry.completedItems = result.job.completed_items;
      }
    } catch (err) {
      entry.error = err instanceof Error ? err.message : "Falha ao enfileirar job";
    }

    results.push(entry);
  }

  return { results, schemaOk: true };
}
