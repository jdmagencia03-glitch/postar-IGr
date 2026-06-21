import { randomUUID } from "crypto";
import { waitUntil } from "@vercel/functions";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  SCHEDULE_JOB_CRON_CHUNKS_PER_JOB,
  SCHEDULE_JOB_CRON_MAX_JOBS,
  SCHEDULE_JOB_LOCK_TTL_MS,
} from "@/lib/schedule-jobs/constants";
import { advanceScheduleJob } from "@/lib/schedule-jobs/processor";
import {
  getScheduleJobHeader,
  updateJobCounters,
} from "@/lib/schedule-jobs/repository";
import {
  isLockExpired,
  isTerminalScheduleJobStatus,
  isWorkerActive,
  logScheduleJobEvent,
} from "@/lib/schedule-jobs/state";
import type { ScheduleJobRow } from "@/lib/schedule-jobs/types";

function isLockSchemaError(error: unknown) {
  const msg = error instanceof Error ? error.message : String(error);
  return /locked_by|lock_until|last_heartbeat|Could not find the .* column|column.*does not exist|schema cache/i.test(
    msg,
  );
}

export function createWorkerId(prefix: string) {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}

async function getJobForWorker(supabase: SupabaseClient, jobId: string) {
  const { data, error } = await supabase
    .from("schedule_jobs")
    .select("*")
    .eq("id", jobId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return (data as ScheduleJobRow | null) ?? null;
}

export type JobLockResult =
  | { mode: "locked"; job: ScheduleJobRow }
  | { mode: "lockless"; job: ScheduleJobRow }
  | { mode: "busy"; job: ScheduleJobRow | null };

export async function acquireJobLock(
  supabase: SupabaseClient,
  jobId: string,
  workerId: string,
): Promise<JobLockResult> {
  const current = await getJobForWorker(supabase, jobId);
  if (!current) return { mode: "busy", job: null };
  if (!["queued", "processing"].includes(current.status)) {
    return { mode: "busy", job: current };
  }
  if (!isLockExpired(current)) {
    return { mode: "busy", job: current };
  }

  const now = new Date();
  const lockUntil = new Date(now.getTime() + SCHEDULE_JOB_LOCK_TTL_MS);
  const patch = {
    locked_by: workerId,
    lock_until: lockUntil.toISOString(),
    last_heartbeat_at: now.toISOString(),
    updated_at: now.toISOString(),
  };

  let query = supabase.from("schedule_jobs").update(patch).eq("id", jobId);

  if (current.locked_by) {
    query = query.eq("locked_by", current.locked_by);
  } else {
    query = query.is("locked_by", null);
  }

  const { data, error } = await query.select("*").maybeSingle();
  if (error) {
    if (isLockSchemaError(error)) {
      return { mode: "lockless", job: current };
    }
    throw new Error(error.message);
  }
  if (!data || data.locked_by !== workerId) {
    return { mode: "busy", job: current };
  }

  logScheduleJobEvent("schedule-job-worker-lock", data as ScheduleJobRow, { workerId });
  return { mode: "locked", job: data as ScheduleJobRow };
}

export async function touchJobHeartbeat(
  supabase: SupabaseClient,
  jobId: string,
  workerId: string,
) {
  const now = new Date();
  const lockUntil = new Date(now.getTime() + SCHEDULE_JOB_LOCK_TTL_MS);

  await supabase
    .from("schedule_jobs")
    .update({
      last_heartbeat_at: now.toISOString(),
      lock_until: lockUntil.toISOString(),
      updated_at: now.toISOString(),
    })
    .eq("id", jobId)
    .eq("locked_by", workerId);
}

export async function releaseJobLock(
  supabase: SupabaseClient,
  jobId: string,
  workerId: string,
) {
  await supabase
    .from("schedule_jobs")
    .update({
      locked_by: null,
      lock_until: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId)
    .eq("locked_by", workerId);
}

type WorkerRunOptions = {
  workerId: string;
  maxChunks?: number;
  lockless: boolean;
  job: ScheduleJobRow;
};

async function resolveJobLock(
  supabase: SupabaseClient,
  jobId: string,
  workerId: string,
  locklessMode: boolean,
): Promise<
  | { ok: false; job: ScheduleJobRow | null }
  | { ok: true; lockless: boolean; job: ScheduleJobRow }
> {
  if (locklessMode) {
    const current = await getJobForWorker(supabase, jobId);
    if (!current || !["queued", "processing"].includes(current.status)) {
      return { ok: false, job: current };
    }

    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from("schedule_jobs")
      .update({ updated_at: now })
      .eq("id", jobId)
      .eq("updated_at", current.updated_at)
      .in("status", ["queued", "processing"])
      .select("*")
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data) return { ok: false, job: current };

    return { ok: true, lockless: true, job: data as ScheduleJobRow };
  }

  const lock = await acquireJobLock(supabase, jobId, workerId);
  if (lock.mode === "busy") {
    return { ok: false, job: lock.job };
  }

  return { ok: true, lockless: lock.mode === "lockless", job: lock.job };
}

async function runScheduleJobChunks(
  supabase: SupabaseClient,
  ownerId: string,
  jobId: string,
  options: WorkerRunOptions,
) {
  const maxChunks = options.maxChunks ?? SCHEDULE_JOB_CRON_CHUNKS_PER_JOB;

  try {
    let job = options.job;
    for (let chunk = 0; chunk < maxChunks; chunk++) {
      if (!options.lockless) {
        await touchJobHeartbeat(supabase, jobId, options.workerId);
      }
      const status = await advanceScheduleJob(supabase, ownerId, jobId);
      job = (await getJobForWorker(supabase, jobId)) ?? job;

      if (!status.isActive || isTerminalScheduleJobStatus(status.status)) {
        break;
      }
    }

    logScheduleJobEvent("schedule-job-worker-chunk", job, {
      workerId: options.workerId,
      maxChunks,
      lockless: options.lockless,
    });

    return job;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha no worker";
    await updateJobCounters(supabase, jobId, {
      error_message: message,
    } as Partial<ScheduleJobRow>).catch(() => undefined);
    const failedJob = await getJobForWorker(supabase, jobId);
    if (failedJob) {
      logScheduleJobEvent("schedule-job-paused", failedJob, {
        workerId: options.workerId,
        lastError: message,
      });
    }
    throw error;
  } finally {
    if (!options.lockless) {
      await releaseJobLock(supabase, jobId, options.workerId).catch(() => undefined);
    }
  }
}

export async function processScheduleJobWithLock(
  supabase: SupabaseClient,
  ownerId: string,
  jobId: string,
  options: { workerId: string; maxChunks?: number; lockless?: boolean },
) {
  const resolved = await resolveJobLock(
    supabase,
    jobId,
    options.workerId,
    Boolean(options.lockless),
  );
  if (!resolved.ok) {
    return { acquired: false as const, job: resolved.job };
  }

  const job = await runScheduleJobChunks(supabase, ownerId, jobId, {
    workerId: options.workerId,
    maxChunks: options.maxChunks,
    lockless: resolved.lockless,
    job: resolved.job,
  });

  return { acquired: true as const, job };
}

/** Responde rápido ao cron; processa o chunk em background (waitUntil). */
export async function enqueueScheduleJobWithLock(
  supabase: SupabaseClient,
  ownerId: string,
  jobId: string,
  options: { workerId: string; maxChunks?: number; lockless?: boolean },
) {
  const resolved = await resolveJobLock(
    supabase,
    jobId,
    options.workerId,
    Boolean(options.lockless),
  );
  if (!resolved.ok) {
    return { accepted: false as const, job: resolved.job };
  }

  waitUntil(
    runScheduleJobChunks(supabase, ownerId, jobId, {
      workerId: options.workerId,
      maxChunks: options.maxChunks,
      lockless: resolved.lockless,
      job: resolved.job,
    }).catch((error) => {
      console.error("[schedule-jobs/enqueue]", error);
    }),
  );

  return { accepted: true as const, job: resolved.job };
}

export async function findJobsForWorker(
  supabase: SupabaseClient,
  limit = SCHEDULE_JOB_CRON_MAX_JOBS,
  options?: { workerColumnsReady?: boolean },
) {
  const workerColumnsReady = options?.workerColumnsReady ?? true;
  const selectCols = workerColumnsReady
    ? "id, owner_id, locked_by, lock_until, last_heartbeat_at, updated_at, status"
    : "id, owner_id, updated_at, status";

  const { data, error } = await supabase
    .from("schedule_jobs")
    .select(selectCols)
    .in("status", ["queued", "processing"])
    .order("updated_at", { ascending: true })
    .limit(limit * 3);

  if (error) throw new Error(error.message);

  type Row = { id: string; owner_id: string };
  const rows = (data ?? []) as unknown as Row[];

  return rows
    .filter((row) => {
      if (!workerColumnsReady) return true;
      const job = row as unknown as ScheduleJobRow;
      return !isWorkerActive(job);
    })
    .slice(0, limit)
    .map((row) => ({
      id: row.id,
      ownerId: row.owner_id,
    }));
}

export async function kickScheduleJobWorker(
  supabase: SupabaseClient,
  ownerId: string,
  jobId: string,
  workerId: string,
) {
  const job = await getScheduleJobHeader(supabase, ownerId, jobId);
  if (!job) throw new Error("Job não encontrado");
  if (isTerminalScheduleJobStatus(job.status)) {
    return { acquired: false as const, job };
  }
  if (isWorkerActive(job)) {
    return { acquired: false as const, job };
  }

  return processScheduleJobWithLock(supabase, ownerId, jobId, {
    workerId,
    maxChunks: SCHEDULE_JOB_CRON_CHUNKS_PER_JOB,
  });
}
