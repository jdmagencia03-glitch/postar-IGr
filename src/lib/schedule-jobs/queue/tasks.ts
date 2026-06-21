import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";
import {
  QUEUE_CALENDAR_CHUNK,
  QUEUE_CAPTION_CHUNK,
  QUEUE_MAX_ACTIVE_JOBS_PER_USER,
  QUEUE_MAX_SAVE_PHASE_JOBS_PER_ACCOUNT,
  QUEUE_SAVE_CHUNK,
  QUEUE_TASK_LOCK_MS,
} from "@/lib/schedule-jobs/queue/constants";
import { resolveJobAccountKey } from "@/lib/schedule-jobs/queue/account-key";
import { ensureJobQueueForCurrentPhase } from "@/lib/schedule-jobs/queue/repair";
import { isScheduleJobQueueReady } from "@/lib/schedule-jobs/queue/schema";
import { isRetryDue, nextRetryAt } from "@/lib/schedule-jobs/queue/retry";
import type { ScheduleJobTaskRow, ScheduleTaskPhase } from "@/lib/schedule-jobs/queue/types";
import type { ScheduleJobRow } from "@/lib/schedule-jobs/types";

export function createTaskWorkerId(prefix: string) {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

export async function countActiveJobsForUser(supabase: SupabaseClient, ownerId: string) {
  const { count, error } = await supabase
    .from("schedule_jobs")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", ownerId)
    .in("status", ["queued", "processing"]);

  if (error) throw new Error(error.message);
  return count ?? 0;
}

export async function assertUserCanCreateJob(supabase: SupabaseClient, ownerId: string) {
  const active = await countActiveJobsForUser(supabase, ownerId);
  if (active >= QUEUE_MAX_ACTIVE_JOBS_PER_USER) {
    throw new Error(
      `Você já tem ${active} agendamento(s) em andamento. Aguarde concluir ou cancele antes de criar outro.`,
    );
  }
}

export async function loadItemIdsForPhase(
  supabase: SupabaseClient,
  jobId: string,
  phase: ScheduleTaskPhase,
): Promise<string[]> {
  if (phase === "captions") {
    const { data, error } = await supabase
      .from("schedule_job_items")
      .select("id, caption, destinations")
      .eq("schedule_job_id", jobId)
      .is("destinations", null)
      .neq("status", "failed")
      .order("sort_order", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? [])
      .filter((row) => {
        const item = row as { caption?: string | null };
        return !item.caption?.trim();
      })
      .map((row) => row.id as string);
  }

  if (phase === "calendar") {
    const { data, error } = await supabase
      .from("schedule_job_items")
      .select("id, caption, destinations")
      .eq("schedule_job_id", jobId)
      .is("destinations", null)
      .not("caption", "is", null)
      .neq("status", "failed")
      .order("sort_order", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? [])
      .filter((row) => Boolean((row as { caption?: string }).caption?.trim()))
      .map((row) => row.id as string);
  }

  const { data, error } = await supabase
    .from("schedule_job_items")
    .select("id, destinations, status, created_post_id")
    .eq("schedule_job_id", jobId)
    .not("destinations", "is", null)
    .in("status", ["queued", "processing", "retrying"])
    .order("sort_order", { ascending: true });

  if (error) throw new Error(error.message);

  return (data ?? [])
    .filter((row) => {
      const item = row as { created_post_id?: string | null; destinations?: unknown };
      return !item.created_post_id;
    })
    .map((row) => row.id as string);
}

export async function materializePhaseTasks(
  supabase: SupabaseClient,
  job: ScheduleJobRow,
  phase: ScheduleTaskPhase,
) {
  const { count, error: existingError } = await supabase
    .from("schedule_job_tasks")
    .select("id", { count: "exact", head: true })
    .eq("schedule_job_id", job.id)
    .eq("phase", phase);

  if (existingError) throw new Error(existingError.message);
  if (phase !== "save_posts" && (count ?? 0) > 0) return 0;

  const itemIds = await loadItemIdsForPhase(supabase, job.id, phase);
  if (!itemIds.length) return 0;

  if (phase === "save_posts" && (count ?? 0) > 0) {
    const { data: existingTasks } = await supabase
      .from("schedule_job_tasks")
      .select("item_ids")
      .eq("schedule_job_id", job.id)
      .eq("phase", phase)
      .neq("status", "cancelled");

    const covered = new Set<string>();
    for (const task of existingTasks ?? []) {
      for (const id of (task.item_ids as string[]) ?? []) {
        covered.add(id);
      }
    }
    const uncovered = itemIds.filter((id) => !covered.has(id));
    if (!uncovered.length) return 0;

    const chunks = chunkArray(uncovered, QUEUE_SAVE_CHUNK);
    const accountKey = resolveJobAccountKey(job);
    const startIndex = count ?? 0;
    const rows = chunks.map((ids, offset) => ({
      schedule_job_id: job.id,
      owner_id: job.owner_id,
      account_key: accountKey,
      phase,
      chunk_index: startIndex + offset,
      item_ids: ids,
      status: "pending" as const,
    }));

    const { error } = await supabase.from("schedule_job_tasks").insert(rows);
    if (error) throw new Error(error.message);
    return rows.length;
  }

  if ((count ?? 0) > 0) return 0;

  const chunkSize =
    phase === "captions"
      ? QUEUE_CAPTION_CHUNK
      : phase === "calendar"
        ? QUEUE_CALENDAR_CHUNK
        : QUEUE_SAVE_CHUNK;

  const chunks = chunkArray(itemIds, chunkSize);
  const accountKey = resolveJobAccountKey(job);
  const rows = chunks.map((ids, chunkIndex) => ({
    schedule_job_id: job.id,
    owner_id: job.owner_id,
    account_key: accountKey,
    phase,
    chunk_index: chunkIndex,
    item_ids: ids,
    status: "pending" as const,
  }));

  const { error } = await supabase.from("schedule_job_tasks").insert(rows);
  if (error) throw new Error(error.message);

  console.info("[schedule-job-created]", {
    jobId: job.id,
    phase,
    tasks: rows.length,
    items: itemIds.length,
  });

  return rows.length;
}

export async function bootstrapJobQueue(supabase: SupabaseClient, job: ScheduleJobRow) {
  await supabase
    .from("schedule_jobs")
    .update({
      status: "processing",
      updated_at: new Date().toISOString(),
    })
    .eq("id", job.id);

  if (!(await isScheduleJobQueueReady(supabase))) {
    return 0;
  }

  const result = await ensureJobQueueForCurrentPhase(supabase, job);
  return result.materialized;
}

export async function maybeMaterializeNextPhase(
  supabase: SupabaseClient,
  job: ScheduleJobRow,
  completedPhase: ScheduleTaskPhase,
) {
  const { count, error } = await supabase
    .from("schedule_job_tasks")
    .select("id", { count: "exact", head: true })
    .eq("schedule_job_id", job.id)
    .eq("phase", completedPhase)
    .in("status", ["pending", "processing", "failed"]);

  if (error) throw new Error(error.message);
  if ((count ?? 0) > 0) return null;

  if (completedPhase === "captions") {
    await supabase
      .from("schedule_jobs")
      .update({ current_step: "captions", updated_at: new Date().toISOString() })
      .eq("id", job.id);
    return materializePhaseTasks(supabase, job, "calendar");
  }

  if (completedPhase === "calendar") {
    await supabase
      .from("schedule_jobs")
      .update({ current_step: "inserting", updated_at: new Date().toISOString() })
      .eq("id", job.id);
    return materializePhaseTasks(supabase, job, "save_posts");
  }

  return null;
}

async function countActiveSaveJobsForAccount(supabase: SupabaseClient, accountKey: string) {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("schedule_job_tasks")
    .select("schedule_job_id")
    .eq("account_key", accountKey)
    .eq("phase", "save_posts")
    .eq("status", "processing")
    .gt("lock_until", now);

  if (error) throw new Error(error.message);
  return new Set((data ?? []).map((row) => row.schedule_job_id as string)).size;
}

export async function claimRunnableTasks(
  supabase: SupabaseClient,
  workerId: string,
  limits: { maxTasks: number; maxAiTasks: number },
) {
  const now = new Date().toISOString();
  const { data: candidates, error } = await supabase
    .from("schedule_job_tasks")
    .select("*")
    .in("status", ["pending", "failed"])
    .order("created_at", { ascending: true })
    .limit(limits.maxTasks * 8);

  if (error) throw new Error(error.message);

  const claimed: ScheduleJobTaskRow[] = [];
  let aiCount = 0;
  const accountSaveActive = new Map<string, number>();

  for (const row of (candidates ?? []) as ScheduleJobTaskRow[]) {
    if (claimed.length >= limits.maxTasks) break;
    if (!isRetryDue(row.next_retry_at)) continue;
    if (row.status === "failed" && row.attempt_count >= row.max_attempts) continue;

    if (row.phase === "captions" && aiCount >= limits.maxAiTasks) continue;

    if (row.phase === "save_posts") {
      const active = accountSaveActive.get(row.account_key) ??
        (await countActiveSaveJobsForAccount(supabase, row.account_key));
      accountSaveActive.set(row.account_key, active);
      if (active >= QUEUE_MAX_SAVE_PHASE_JOBS_PER_ACCOUNT) continue;
    }

    const lockUntil = new Date(Date.now() + QUEUE_TASK_LOCK_MS).toISOString();
    const { data: locked, error: lockError } = await supabase
      .from("schedule_job_tasks")
      .update({
        status: "processing",
        locked_by: workerId,
        lock_until: lockUntil,
        last_heartbeat_at: now,
        updated_at: now,
        attempt_count: row.status === "failed" ? row.attempt_count + 1 : row.attempt_count,
        error_message: null,
      })
      .eq("id", row.id)
      .in("status", ["pending", "failed"])
      .select("*")
      .maybeSingle();

    if (lockError || !locked || locked.locked_by !== workerId) continue;

    claimed.push(locked as ScheduleJobTaskRow);
    if (row.phase === "captions") aiCount += 1;
    if (row.phase === "save_posts") {
      accountSaveActive.set(row.account_key, (accountSaveActive.get(row.account_key) ?? 0) + 1);
    }
  }

  return claimed;
}

export async function completeTask(supabase: SupabaseClient, taskId: string, workerId: string) {
  const now = new Date().toISOString();
  await supabase
    .from("schedule_job_tasks")
    .update({
      status: "completed",
      locked_by: null,
      lock_until: null,
      completed_at: now,
      updated_at: now,
    })
    .eq("id", taskId)
    .eq("locked_by", workerId);
}

export async function failTask(
  supabase: SupabaseClient,
  task: ScheduleJobTaskRow,
  workerId: string,
  message: string,
) {
  const attempts = task.attempt_count + 1;
  const retry = nextRetryAt(attempts);
  const terminal = attempts >= task.max_attempts || !retry;

  await supabase
    .from("schedule_job_tasks")
    .update({
      status: terminal ? "failed" : "pending",
      locked_by: null,
      lock_until: null,
      attempt_count: attempts,
      next_retry_at: terminal ? null : retry!.toISOString(),
      error_message: message,
      updated_at: new Date().toISOString(),
    })
    .eq("id", task.id)
    .eq("locked_by", workerId);

  console.warn("[schedule-job-retry]", {
    taskId: task.id,
    jobId: task.schedule_job_id,
    phase: task.phase,
    attempts,
    terminal,
    message,
  });
}

export async function releaseExpiredTaskLocks(supabase: SupabaseClient) {
  const now = new Date().toISOString();
  await supabase
    .from("schedule_job_tasks")
    .update({
      status: "pending",
      locked_by: null,
      lock_until: null,
      updated_at: now,
    })
    .eq("status", "processing")
    .lt("lock_until", now);
}

export async function getJobByIdAdmin(supabase: SupabaseClient, jobId: string) {
  const { data, error } = await supabase
    .from("schedule_jobs")
    .select("*")
    .eq("id", jobId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as ScheduleJobRow | null) ?? null;
}

export async function listQueueStats(supabase: SupabaseClient) {
  if (!(await isScheduleJobQueueReady(supabase))) {
    return { pending: 0, processing: 0, failed: 0, completed: 0 };
  }

  const statuses = ["pending", "processing", "failed", "completed"] as const;
  const stats: Record<string, number> = {};

  for (const status of statuses) {
    const { count } = await supabase
      .from("schedule_job_tasks")
      .select("id", { count: "exact", head: true })
      .eq("status", status);
    stats[status] = count ?? 0;
  }

  return stats;
}
