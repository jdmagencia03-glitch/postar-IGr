import type { SupabaseClient } from "@supabase/supabase-js";
import {
  QUEUE_CRON_MAX_MS,
  QUEUE_MAX_AI_TASKS_PER_DRAIN,
  QUEUE_MAX_TASKS_PER_DRAIN,
} from "@/lib/schedule-jobs/queue/constants";
import { runScheduleTask } from "@/lib/schedule-jobs/queue/runner";
import { isScheduleJobQueueReady } from "@/lib/schedule-jobs/queue/schema";
import {
  isPipelineColumnReady,
  pipelineMigrationMessage,
  PIPELINE_MIGRATION_REQUIRED,
} from "@/lib/schedule-jobs/pipeline-schema";
import { markJobInfrastructureError } from "@/lib/schedule-jobs/repository";
import {
  claimRunnableTasks,
  createTaskWorkerId,
  releaseExpiredTaskLocks,
} from "@/lib/schedule-jobs/queue/tasks";
import { recoverStuckScheduleJobs } from "@/lib/schedule-jobs/queue/stuck";

export type DrainQueueResult = {
  claimed: number;
  processed: number;
  errors: string[];
  mode?: "queue" | "queue_unavailable";
  rounds?: number;
  elapsedMs?: number;
};

async function drainQueueOnce(
  supabase: SupabaseClient,
  workerPrefix: string,
): Promise<Omit<DrainQueueResult, "mode" | "rounds" | "elapsedMs">> {
  const workerId = createTaskWorkerId(workerPrefix);

  await releaseExpiredTaskLocks(supabase);
  await recoverStuckScheduleJobs(supabase);

  const tasks = await claimRunnableTasks(supabase, workerId, {
    maxTasks: QUEUE_MAX_TASKS_PER_DRAIN,
    maxAiTasks: QUEUE_MAX_AI_TASKS_PER_DRAIN,
  });

  const errors: string[] = [];
  let processed = 0;

  for (const task of tasks) {
    try {
      await runScheduleTask(supabase, task, workerId);
      processed += 1;
    } catch (err) {
      errors.push(err instanceof Error ? err.message : "task failed");
    }
  }

  return { claimed: tasks.length, processed, errors };
}

export async function drainScheduleJobQueue(
  supabase: SupabaseClient,
  options?: { workerPrefix?: string; maxMs?: number },
): Promise<DrainQueueResult> {
  const started = Date.now();
  const maxMs = options?.maxMs ?? QUEUE_CRON_MAX_MS;
  const deadline = started + maxMs;
  const workerPrefix = options?.workerPrefix ?? "queue";

  const queueReady = await isScheduleJobQueueReady(supabase);
  if (!queueReady) {
    return {
      claimed: 0,
      processed: 0,
      errors: [
        "queue_not_ready: fila schedule_job_tasks indisponível — job permanece em fila aguardando retry (sem fallback legado).",
      ],
      mode: "queue_unavailable",
      rounds: 0,
      elapsedMs: Date.now() - started,
    };
  }

  const pipelineReady = await isPipelineColumnReady(supabase);
  if (!pipelineReady) {
    return {
      claimed: 0,
      processed: 0,
      errors: [pipelineMigrationMessage()],
      mode: "queue_unavailable",
      rounds: 0,
      elapsedMs: Date.now() - started,
    };
  }

  let totalClaimed = 0;
  let totalProcessed = 0;
  const errors: string[] = [];
  let rounds = 0;

  while (Date.now() < deadline) {
    const round = await drainQueueOnce(supabase, workerPrefix);
    rounds += 1;
    totalClaimed += round.claimed;
    totalProcessed += round.processed;
    errors.push(...round.errors);

    if (round.claimed === 0) break;
    if (round.processed === 0 && round.claimed > 0) break;
  }

  return {
    claimed: totalClaimed,
    processed: totalProcessed,
    errors,
    mode: "queue",
    rounds,
    elapsedMs: Date.now() - started,
  };
}
