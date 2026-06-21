import {
  SCHEDULE_JOB_INSERT_CHUNK,
  SCHEDULE_JOB_PLAN_CHUNK,
} from "@/lib/schedule-jobs/constants";
import type { ScheduleJobRow } from "@/lib/schedule-jobs/types";

export type ScheduleJobChunkTiming = {
  index: number;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  posts: number;
  kind: "plan" | "insert";
};

export type ScheduleJobTiming = {
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  queueWaitMs: number | null;
  processingMs: number | null;
  chunks: ScheduleJobChunkTiming[];
};

function msBetween(start: string | null | undefined, end: string | null | undefined) {
  if (!start || !end) return null;
  const delta = new Date(end).getTime() - new Date(start).getTime();
  return delta >= 0 ? delta : null;
}

function inferStartedAt(job: ScheduleJobRow): string | null {
  if (job.status === "queued" && !job.locked_by) return null;
  return job.last_heartbeat_at ?? job.updated_at ?? null;
}

function buildChunkTimings(job: ScheduleJobRow, startedAt: string | null): ScheduleJobChunkTiming[] {
  const chunks: ScheduleJobChunkTiming[] = [];
  const completedAt = job.completed_at ?? (job.status === "completed" ? job.updated_at : null);

  const planChunksTotal = Math.max(1, Math.ceil(job.total_items / SCHEDULE_JOB_PLAN_CHUNK));
  const planChunksDone = Math.min(
    planChunksTotal,
    Math.ceil(job.processed_items / SCHEDULE_JOB_PLAN_CHUNK),
  );

  for (let index = 1; index <= planChunksTotal; index += 1) {
    const postsInChunk =
      index < planChunksTotal
        ? SCHEDULE_JOB_PLAN_CHUNK
        : job.total_items - SCHEDULE_JOB_PLAN_CHUNK * (planChunksTotal - 1);
    const chunkStarted = index === 1 ? startedAt : null;
    const chunkCompleted =
      index <= planChunksDone
        ? job.processed_items >= job.total_items && index === planChunksTotal
          ? completedAt ?? job.updated_at
          : job.updated_at
        : null;

    chunks.push({
      index,
      kind: "plan",
      posts: postsInChunk,
      startedAt: chunkStarted,
      completedAt: chunkCompleted,
      durationMs: msBetween(chunkStarted, chunkCompleted),
    });
  }

  const insertChunksTotal = Math.max(1, Math.ceil(job.total_items / SCHEDULE_JOB_INSERT_CHUNK));
  const insertChunksDone = Math.min(
    insertChunksTotal,
    Math.ceil(job.completed_items / SCHEDULE_JOB_INSERT_CHUNK),
  );

  for (let index = 1; index <= insertChunksTotal; index += 1) {
    const postsInChunk =
      index < insertChunksTotal
        ? SCHEDULE_JOB_INSERT_CHUNK
        : job.total_items - SCHEDULE_JOB_INSERT_CHUNK * (insertChunksTotal - 1);
    const chunkStarted =
      job.processed_items >= job.total_items && index === 1 ? startedAt : null;
    const chunkCompleted =
      index <= insertChunksDone
        ? job.status === "completed" || job.status === "partial_failed"
          ? completedAt ?? job.updated_at
          : job.updated_at
        : null;

    chunks.push({
      index: planChunksTotal + index,
      kind: "insert",
      posts: postsInChunk,
      startedAt: chunkStarted,
      completedAt: chunkCompleted,
      durationMs: msBetween(chunkStarted, chunkCompleted),
    });
  }

  return chunks;
}

export function buildScheduleJobTiming(job: ScheduleJobRow): ScheduleJobTiming {
  const createdAt = job.created_at;
  const startedAt = inferStartedAt(job);
  const completedAt =
    job.completed_at ??
    (job.status === "completed" || job.status === "partial_failed" ? job.updated_at : null);

  const durationMs = msBetween(createdAt, completedAt);
  const queueWaitMs = msBetween(createdAt, startedAt);
  const processingMs = msBetween(startedAt, completedAt);

  return {
    createdAt,
    startedAt,
    completedAt,
    durationMs,
    queueWaitMs,
    processingMs,
    chunks: buildChunkTimings(job, startedAt),
  };
}
