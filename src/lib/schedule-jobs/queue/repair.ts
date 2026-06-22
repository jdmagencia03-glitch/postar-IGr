import { repairSavePostsTaskConsistency } from "@/lib/schedule-jobs/consistency";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  QUEUE_CALENDAR_CHUNK,
  QUEUE_CAPTION_CHUNK,
  QUEUE_SAVE_CHUNK,
} from "@/lib/schedule-jobs/queue/constants";
import { resolveJobAccountKey } from "@/lib/schedule-jobs/queue/account-key";
import { isScheduleJobQueueReady } from "@/lib/schedule-jobs/queue/schema";
import {
  loadItemIdsForPhase,
  materializePhaseTasks,
  releaseExpiredTaskLocks,
} from "@/lib/schedule-jobs/queue/tasks";
import { syncJobCountersFromDb, updateJobCounters } from "@/lib/schedule-jobs/repository";
import type { ScheduleTaskPhase } from "@/lib/schedule-jobs/queue/types";
import type { ScheduleJobRow } from "@/lib/schedule-jobs/types";

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

async function releaseStuckJobLock(supabase: SupabaseClient, jobId: string) {
  const now = new Date().toISOString();
  await supabase
    .from("schedule_jobs")
    .update({
      locked_by: null,
      lock_until: null,
      error_message: null,
      updated_at: now,
    })
    .eq("id", jobId);
}

async function releaseStuckTasksForJob(supabase: SupabaseClient, jobId: string) {
  const now = new Date().toISOString();
  await supabase
    .from("schedule_job_tasks")
    .update({
      status: "pending",
      locked_by: null,
      lock_until: null,
      updated_at: now,
    })
    .eq("schedule_job_id", jobId)
    .eq("status", "processing")
    .lt("lock_until", now);
}

async function getCoveredItemIds(
  supabase: SupabaseClient,
  jobId: string,
  phase: ScheduleTaskPhase,
) {
  const { data, error } = await supabase
    .from("schedule_job_tasks")
    .select("item_ids, status")
    .eq("schedule_job_id", jobId)
    .eq("phase", phase)
    .neq("status", "cancelled");

  if (error) throw new Error(error.message);

  const covered = new Set<string>();
  for (const row of data ?? []) {
    for (const id of (row.item_ids as string[]) ?? []) {
      covered.add(id);
    }
  }
  return covered;
}

/** Cria tasks faltantes para itens ainda não cobertos (corrige jobs migrados para fila). */
export async function materializeMissingSavePostTasks(
  supabase: SupabaseClient,
  job: ScheduleJobRow,
) {
  if (!(await isScheduleJobQueueReady(supabase))) return 0;

  const pendingIds = await loadItemIdsForPhase(supabase, job.id, "save_posts");
  if (!pendingIds.length) return 0;

  const covered = await getCoveredItemIds(supabase, job.id, "save_posts");
  const uncovered = pendingIds.filter((id) => !covered.has(id));
  if (!uncovered.length) return 0;

  const { count: existingCount } = await supabase
    .from("schedule_job_tasks")
    .select("id", { count: "exact", head: true })
    .eq("schedule_job_id", job.id)
    .eq("phase", "save_posts");

  const chunks = chunkArray(uncovered, QUEUE_SAVE_CHUNK);
  const accountKey = resolveJobAccountKey(job);
  const startIndex = existingCount ?? 0;

  const rows = chunks.map((ids, offset) => ({
    schedule_job_id: job.id,
    owner_id: job.owner_id,
    account_key: accountKey,
    phase: "save_posts" as const,
    chunk_index: startIndex + offset,
    item_ids: ids,
    status: "pending" as const,
  }));

  const { error } = await supabase.from("schedule_job_tasks").insert(rows);
  if (error) throw new Error(error.message);

  console.info("[schedule-job-repair]", {
    jobId: job.id,
    phase: "save_posts",
    newTasks: rows.length,
    uncoveredItems: uncovered.length,
  });

  return rows.length;
}

export async function ensureJobQueueForCurrentPhase(
  supabase: SupabaseClient,
  job: ScheduleJobRow,
) {
  if (!(await isScheduleJobQueueReady(supabase))) {
    return { materialized: 0, phase: "legacy" as const };
  }

  const counts = await syncJobCountersFromDb(supabase, job.id);
  let materialized = 0;

  if (counts.processed < counts.total) {
    materialized += await materializePhaseTasks(supabase, job, "captions");
    materialized += await materializePhaseTasks(supabase, job, "calendar");
  }

  if (counts.processed >= counts.total && counts.completed < counts.total) {
    await supabase
      .from("schedule_jobs")
      .update({
        status: "processing",
        current_step: "inserting",
        updated_at: new Date().toISOString(),
      })
      .eq("id", job.id);

    materialized += await materializePhaseTasks(supabase, job, "save_posts");
    materialized += await materializeMissingSavePostTasks(supabase, job);
    return { materialized, phase: "save_posts" as const };
  }

  return { materialized, phase: "captions" as const };
}

export type RepairJobResult = {
  releasedJobLock: boolean;
  releasedTaskLocks: boolean;
  materializedTasks: number;
  phase: string;
  counts: Awaited<ReturnType<typeof syncJobCountersFromDb>>;
};

export async function repairScheduleJob(
  supabase: SupabaseClient,
  jobId: string,
): Promise<RepairJobResult> {
  const { data: job, error } = await supabase
    .from("schedule_jobs")
    .select("*")
    .eq("id", jobId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!job) throw new Error("Job não encontrado");

  const row = job as ScheduleJobRow;

  await releaseExpiredTaskLocks(supabase);
  await releaseStuckTasksForJob(supabase, jobId);
  await releaseStuckJobLock(supabase, jobId);
  await repairSavePostsTaskConsistency(supabase, jobId);

  const queue = await ensureJobQueueForCurrentPhase(supabase, row);
  const counts = await syncJobCountersFromDb(supabase, jobId);

  await updateJobCounters(supabase, jobId, {
    status: "processing",
    completed_items: counts.completed,
    failed_items: counts.failed,
    processed_items: counts.processed,
    error_message: null,
  } as Partial<ScheduleJobRow>);

  return {
    releasedJobLock: true,
    releasedTaskLocks: true,
    materializedTasks: queue.materialized,
    phase: queue.phase,
    counts,
  };
}

export type JobDiagnostics = {
  jobId: string;
  status: string;
  currentStep: string;
  totalItems: number;
  completedItems: number;
  processedItems: number;
  failedItems: number;
  lockedBy: string | null;
  lockUntil: string | null;
  lastHeartbeatAt: string | null;
  updatedAt: string;
  minutesSinceUpdate: number;
  postsInCalendar: number;
  itemStatusCounts: Record<string, number>;
  taskStatusCounts: Record<string, number>;
  pendingSaveItems: number;
  diagnosis: string;
  queueReady: boolean;
};

export async function getScheduleJobDiagnostics(
  supabase: SupabaseClient,
  jobId: string,
): Promise<JobDiagnostics> {
  const { data: job, error } = await supabase
    .from("schedule_jobs")
    .select("*")
    .eq("id", jobId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!job) throw new Error("Job não encontrado");

  const row = job as ScheduleJobRow;
  const queueReady = await isScheduleJobQueueReady(supabase);

  const { data: items } = await supabase
    .from("schedule_job_items")
    .select("status")
    .eq("schedule_job_id", jobId);

  const itemStatusCounts: Record<string, number> = {};
  for (const item of items ?? []) {
    const status = item.status as string;
    itemStatusCounts[status] = (itemStatusCounts[status] ?? 0) + 1;
  }

  const taskStatusCounts: Record<string, number> = {};
  if (queueReady) {
    const { data: tasks } = await supabase
      .from("schedule_job_tasks")
      .select("status, phase")
      .eq("schedule_job_id", jobId);

    for (const task of tasks ?? []) {
      const key = `${task.phase}:${task.status}`;
      taskStatusCounts[key] = (taskStatusCounts[key] ?? 0) + 1;
    }
  }

  let postsInCalendar = 0;
  if (row.upload_batch_id) {
    const { count } = await supabase
      .from("scheduled_posts")
      .select("id", { count: "exact", head: true })
      .eq("upload_batch_id", row.upload_batch_id);
    postsInCalendar = count ?? 0;
  }

  const pendingSaveItems = queueReady
    ? (await loadItemIdsForPhase(supabase, jobId, "save_posts")).length
    : Math.max(0, row.total_items - row.completed_items - row.failed_items);

  const minutesSinceUpdate =
    (Date.now() - new Date(row.updated_at).getTime()) / 60_000;

  let diagnosis = "ativo";
  if (row.status === "completed" || row.status === "partial_failed") {
    diagnosis = "finalizado";
  } else if (row.status === "cancelled" || row.status === "failed") {
    diagnosis = "parado";
  } else if (row.last_heartbeat_at) {
    const heartbeatAge =
      (Date.now() - new Date(row.last_heartbeat_at).getTime()) / 60_000;
    if (heartbeatAge < 2) diagnosis = "worker_ativo";
    else if (minutesSinceUpdate < 10) diagnosis = "vivo_mas_lento";
    else diagnosis = "travado";
  } else if (minutesSinceUpdate >= 10) {
    diagnosis = "travado";
  } else if (minutesSinceUpdate >= 2) {
    diagnosis = "vivo_mas_lento";
  }

  return {
    jobId: row.id,
    status: row.status,
    currentStep: row.current_step,
    totalItems: row.total_items,
    completedItems: row.completed_items,
    processedItems: row.processed_items,
    failedItems: row.failed_items,
    lockedBy: row.locked_by ?? null,
    lockUntil: row.lock_until ?? null,
    lastHeartbeatAt: row.last_heartbeat_at ?? null,
    updatedAt: row.updated_at,
    minutesSinceUpdate: Math.round(minutesSinceUpdate * 10) / 10,
    postsInCalendar,
    itemStatusCounts,
    taskStatusCounts,
    pendingSaveItems,
    diagnosis,
    queueReady,
  };
}
