import { normalizeWarmupScheduleSummary } from "@/lib/schedule-plan";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  ScheduleJobConfig,
  ScheduleJobItemRow,
  ScheduleJobRow,
  ScheduleJobStatusResponse,
} from "@/lib/schedule-jobs/types";
import {
  SCHEDULE_JOB_CREATE_CHUNK,
  SCHEDULE_JOB_INSERT_CHUNK,
  SCHEDULE_JOB_PLAN_CHUNK,
} from "@/lib/schedule-jobs/constants";
import {
  applyConsistencyToView,
  loadJobConsistencySnapshot,
  repairPartialSaveConsistency,
  repairSavePostsTaskConsistency,
  type JobConsistencySnapshot,
} from "@/lib/schedule-jobs/consistency";
import {
  deriveScheduleJobView,
  logScheduleJobEvent,
} from "@/lib/schedule-jobs/state";
import { buildScheduleJobTiming } from "@/lib/schedule-jobs/timing";
import {
  countItemPipeline,
  type ItemPipelineCounts,
} from "@/lib/schedule-jobs/item-pipeline";
import {
  isPipelineColumnError,
  isPipelineColumnReady,
  pipelineMigrationMessage,
  PIPELINE_MIGRATION_REQUIRED,
  resetPipelineColumnCache,
} from "@/lib/schedule-jobs/pipeline-schema";
import { isScheduleJobQueueReady } from "@/lib/schedule-jobs/queue/schema";

function mapItem(row: Record<string, unknown>): ScheduleJobItemRow {
  return {
    ...(row as ScheduleJobItemRow),
    media_urls: Array.isArray(row.media_urls) ? (row.media_urls as string[]) : [],
    destinations: row.destinations as ScheduleJobItemRow["destinations"],
    pipeline:
      row.pipeline && typeof row.pipeline === "object"
        ? (row.pipeline as ScheduleJobItemRow["pipeline"])
        : undefined,
  };
}

export async function findLatestJobForBatch(
  supabase: SupabaseClient,
  ownerId: string,
  uploadBatchId: string,
) {
  const { data, error } = await supabase
    .from("schedule_jobs")
    .select("*")
    .eq("owner_id", ownerId)
    .eq("upload_batch_id", uploadBatchId)
    .neq("status", "cancelled")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data as ScheduleJobRow | null;
}

export async function findActiveJobForBatch(
  supabase: SupabaseClient,
  ownerId: string,
  uploadBatchId: string,
) {
  const { data, error } = await supabase
    .from("schedule_jobs")
    .select("*")
    .eq("owner_id", ownerId)
    .eq("upload_batch_id", uploadBatchId)
    .in("status", ["queued", "processing", "partial_failed"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data as ScheduleJobRow | null;
}

export async function findCompletedJobForBatch(
  supabase: SupabaseClient,
  ownerId: string,
  uploadBatchId: string,
) {
  const { data, error } = await supabase
    .from("schedule_jobs")
    .select("*")
    .eq("owner_id", ownerId)
    .eq("upload_batch_id", uploadBatchId)
    .eq("status", "completed")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data as ScheduleJobRow | null;
}

export async function getScheduleJobHeader(
  supabase: SupabaseClient,
  ownerId: string,
  jobId: string,
) {
  const { data, error } = await supabase
    .from("schedule_jobs")
    .select("*")
    .eq("id", jobId)
    .eq("owner_id", ownerId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return (data as ScheduleJobRow | null) ?? null;
}

export async function getScheduleJob(
  supabase: SupabaseClient,
  ownerId: string,
  jobId: string,
) {
  const { data, error } = await supabase
    .from("schedule_jobs")
    .select("*")
    .eq("id", jobId)
    .eq("owner_id", ownerId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return null;

  const { data: items, error: itemsError } = await supabase
    .from("schedule_job_items")
    .select("*")
    .eq("schedule_job_id", jobId)
    .order("sort_order", { ascending: true });

  if (itemsError) throw new Error(itemsError.message);

  return {
    job: data as ScheduleJobRow,
    items: (items ?? []).map((row) => mapItem(row as Record<string, unknown>)),
  };
}

export async function loadPlanPendingItems(
  supabase: SupabaseClient,
  jobId: string,
  limit = SCHEDULE_JOB_PLAN_CHUNK,
) {
  const { data, error } = await supabase
    .from("schedule_job_items")
    .select("*")
    .eq("schedule_job_id", jobId)
    .is("destinations", null)
    .neq("status", "failed")
    .order("sort_order", { ascending: true })
    .limit(limit);

  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => mapItem(row as Record<string, unknown>));
}

export async function loadInsertPendingItems(
  supabase: SupabaseClient,
  jobId: string,
  limit = SCHEDULE_JOB_INSERT_CHUNK,
) {
  const { data, error } = await supabase
    .from("schedule_job_items")
    .select("*")
    .eq("schedule_job_id", jobId)
    .not("destinations", "is", null)
    .is("created_post_id", null)
    .in("status", ["queued", "processing", "retrying", "completed"])
    .order("sort_order", { ascending: true })
    .limit(limit * 2);

  if (error) throw new Error(error.message);

  const items = (data ?? []).map((row) => mapItem(row as Record<string, unknown>));
  return items
    .filter(
      (item) =>
        item.destinations?.length &&
        !item.destinations.every((dest) => dest.created_post_id),
    )
    .slice(0, limit);
}

export async function loadJobItemsForPipeline(
  supabase: SupabaseClient,
  jobId: string,
): Promise<ScheduleJobItemRow[]> {
  const { data, error } = await supabase
    .from("schedule_job_items")
    .select("*")
    .eq("schedule_job_id", jobId)
    .order("sort_order", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => mapItem(row as Record<string, unknown>));
}

export async function loadItemPipelineCounts(
  supabase: SupabaseClient,
  jobId: string,
): Promise<ItemPipelineCounts> {
  const items = await loadJobItemsForPipeline(supabase, jobId);
  return countItemPipeline(items);
}

export async function syncJobCountersFromDb(supabase: SupabaseClient, jobId: string) {
  const items = await loadJobItemsForPipeline(supabase, jobId);
  const pipeline = countItemPipeline(items);

  return {
    total: pipeline.total,
    completed: pipeline.postsSaved,
    failed: pipeline.failed,
    /** Itens com calendário planejado (destinations). */
    processed: pipeline.calendarDone,
    captionDone: pipeline.captionDone,
    hashtagsDone: pipeline.hashtagsDone,
    calendarDone: pipeline.calendarDone,
    captionPending: pipeline.captionPending,
    captionFailed: pipeline.captionFailed,
    calendarPending: pipeline.calendarPending,
  };
}

async function insertJobItemsChunked(
  supabase: SupabaseClient,
  itemRows: Array<Record<string, unknown>>,
) {
  for (let offset = 0; offset < itemRows.length; offset += SCHEDULE_JOB_CREATE_CHUNK) {
    const chunk = itemRows.slice(offset, offset + SCHEDULE_JOB_CREATE_CHUNK);
    const { error } = await supabase.from("schedule_job_items").insert(chunk);
    if (error) throw new Error(error.message);
  }
}

export async function createScheduleJob(
  supabase: SupabaseClient,
  params: {
    ownerId: string;
    uploadBatchId: string | null;
    accountId: string | null;
    tiktokAccountId: string | null;
    platform: string;
    config: ScheduleJobConfig;
    items: Array<{
      uploadFileId: string;
      sortOrder: number;
      filename: string;
      mediaUrls: string[];
    }>;
  },
) {
  const existing = params.uploadBatchId
    ? await findActiveJobForBatch(supabase, params.ownerId, params.uploadBatchId)
    : null;

  if (existing) {
    logScheduleJobEvent("schedule-job-resumed", existing, { reason: "active_job_exists" });
    return { job: existing, items: [] as ScheduleJobItemRow[] };
  }

  const { data: job, error: jobError } = await supabase
    .from("schedule_jobs")
    .insert({
      owner_id: params.ownerId,
      upload_batch_id: params.uploadBatchId,
      account_id: params.accountId,
      tiktok_account_id: params.tiktokAccountId,
      platform: params.platform,
      mode: "multiplatform",
      schedule_mode: params.config.schedule_mode,
      total_items: params.items.length,
      config: params.config,
      status: "queued",
      current_step: "queued",
    })
    .select("*")
    .single();

  if (jobError || !job) throw new Error(jobError?.message ?? "Falha ao criar job");

  const itemRows = params.items.map((item) => ({
    schedule_job_id: job.id,
    upload_file_id: item.uploadFileId,
    sort_order: item.sortOrder,
    filename: item.filename,
    media_urls: item.mediaUrls,
    status: "queued",
  }));

  try {
    await insertJobItemsChunked(supabase, itemRows);
  } catch (itemsError) {
    await supabase.from("schedule_jobs").delete().eq("id", job.id);
    throw itemsError;
  }

  const createdJob = job as ScheduleJobRow;
  logScheduleJobEvent("schedule-job-created", createdJob, {
    totalItems: createdJob.total_items,
  });

  return { job: createdJob, items: [] as ScheduleJobItemRow[] };
}

export async function updateJobCounters(
  supabase: SupabaseClient,
  jobId: string,
  patch: Partial<ScheduleJobRow>,
) {
  const { error } = await supabase
    .from("schedule_jobs")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", jobId);

  if (error) throw new Error(error.message);
}

export type UpdateJobItemResult = {
  ok: boolean;
  code?: typeof PIPELINE_MIGRATION_REQUIRED;
  pipelineSkipped?: boolean;
};

export async function markJobInfrastructureError(
  supabase: SupabaseClient,
  jobId: string,
  code: typeof PIPELINE_MIGRATION_REQUIRED | "queue_not_ready",
  message: string,
) {
  await updateJobCounters(supabase, jobId, {
    status: "queued",
    error_message: `${code}: ${message}`,
  } as Partial<ScheduleJobRow>);
}

export async function updateJobItem(
  supabase: SupabaseClient,
  itemId: string,
  patch: Record<string, unknown>,
): Promise<UpdateJobItemResult> {
  const columnReady = await isPipelineColumnReady(supabase);
  let effectivePatch = { ...patch };

  if (!columnReady && "pipeline" in effectivePatch) {
    const { pipeline: _pipeline, ...rest } = effectivePatch;
    effectivePatch = rest;
    if (Object.keys(effectivePatch).length === 0) {
      return { ok: false, code: PIPELINE_MIGRATION_REQUIRED, pipelineSkipped: true };
    }
  }

  const { error } = await supabase
    .from("schedule_job_items")
    .update({ ...effectivePatch, updated_at: new Date().toISOString() })
    .eq("id", itemId);

  if (error) {
    if (isPipelineColumnError(error.message)) {
      resetPipelineColumnCache();
      const { pipeline: _pipeline, ...rest } = patch;
      if (Object.keys(rest).length === 0) {
        return { ok: false, code: PIPELINE_MIGRATION_REQUIRED, pipelineSkipped: true };
      }
      const retry = await supabase
        .from("schedule_job_items")
        .update({ ...rest, updated_at: new Date().toISOString() })
        .eq("id", itemId);
      if (retry.error) throw new Error(retry.error.message);
      return { ok: true, pipelineSkipped: true };
    }
    throw new Error(error.message);
  }

  return {
    ok: true,
    pipelineSkipped: !columnReady && "pipeline" in patch,
  };
}

export function buildJobStatusFromJob(
  job: ScheduleJobRow,
  items?: import("@/lib/schedule-jobs/types").ScheduleJobItemRow[],
  consistency?: JobConsistencySnapshot,
  pipelineCounts?: ItemPipelineCounts,
): ScheduleJobStatusResponse {
  const baseView = deriveScheduleJobView(job, pipelineCounts);
  const view = consistency ? applyConsistencyToView(baseView, consistency, job) : baseView;
  const timing = buildScheduleJobTiming(job);
  const schedulePlan = job.config?.schedule_plan;
  const plannedFromItems =
    items
      ?.flatMap((item) => item.destinations ?? [])
      .filter((dest) => dest.scheduled_at)
      .map((dest, index) => ({
        dayIndex: index + 1,
        scheduledAt: dest.scheduled_at,
        slot: new Date(dest.scheduled_at).toLocaleTimeString("pt-BR", {
          hour: "2-digit",
          minute: "2-digit",
          timeZone: "America/Sao_Paulo",
        }),
        slotSource: "warmup_fixed" as const,
      })) ?? [];

  return {
    jobId: job.id,
    status: job.status,
    phase: view.phase,
    currentStep: job.current_step,
    total: job.total_items,
    processed: view.captionsDone,
    completed: view.postsSaved,
    failed: job.failed_items,
    pending: view.pendingItems,
    captionsDone: view.captionsDone,
    hashtagsDone: view.hashtagsDone,
    calendarDone: view.calendarDone,
    postsSaved: view.postsSaved,
    planChunksTotal: view.planChunksTotal,
    planChunksDone: view.planChunksDone,
    insertChunksTotal: view.insertChunksTotal,
    insertChunksDone: view.insertChunksDone,
    scheduleSummary: normalizeWarmupScheduleSummary(job.schedule_summary),
    planReady: view.planReady,
    errorMessage: job.error_message,
    isActive: view.isActive,
    workerActive: view.workerActive,
    workerStatus: view.workerStatus,
    workerLabel: view.workerLabel,
    canResume: view.canResume,
    canForceContinue: view.canForceContinue,
    canFinalizePosts: view.canFinalizePosts,
    isStalled: view.isStalled,
    stalledReason: view.stalledReason,
    recommendedAction: view.recommendedAction,
    missingPosts: Math.max(0, job.total_items - view.postsSaved - job.failed_items),
    canCancel: view.canCancel,
    canOpenCalendar: view.canOpenCalendar,
    hasActiveError: view.hasActiveError,
    lastHeartbeatAt: job.last_heartbeat_at ?? null,
    lastError: job.error_message,
    stepLabel: view.stepLabel,
    headline: view.headline,
    progressLabel: view.progressLabel,
    progressPercent: view.progressPercent,
    planSummaryLabel: view.planSummaryLabel,
    postsSummaryLabel: view.postsSummaryLabel,
    steps: view.steps,
    updatedAt: job.updated_at,
    timing,
    batchId: job.upload_batch_id,
    scheduleMode: (job.schedule_mode as ScheduleJobStatusResponse["scheduleMode"]) ?? "auto",
    warmupPattern:
      schedulePlan?.warmupPattern ??
      (job.schedule_mode === "warmup" ? "3→3→4→4→7" : null),
    skippedPastSlots: schedulePlan?.skippedPastSlots ?? [],
    plannedPosts: schedulePlan?.plannedPosts?.length
      ? schedulePlan.plannedPosts
      : plannedFromItems,
    postsInCalendar: consistency?.postsInCalendar ?? view.postsSaved,
    pendingSaveItems: consistency?.pendingSaveItems ?? view.pendingItems,
    consistencyErrors: consistency?.errors ?? [],
    canDiscardJob:
      consistency?.isInconsistent &&
      (consistency.postsInCalendar === 0) &&
      job.status !== "cancelled" &&
      job.status !== "completed",
  };
}

export async function buildJobStatusReadOnly(
  supabase: SupabaseClient,
  job: ScheduleJobRow,
  items?: ScheduleJobItemRow[],
) {
  await repairPartialSaveConsistency(supabase, job);

  const [consistency, pipelineCounts, pipelineReady, queueReady] = await Promise.all([
    loadJobConsistencySnapshot(supabase, job),
    loadItemPipelineCounts(supabase, job.id),
    isPipelineColumnReady(supabase),
    isScheduleJobQueueReady(supabase),
  ]);
  const status = buildJobStatusFromJob(job, items, consistency, pipelineCounts);
  const infrastructureError = !pipelineReady
    ? pipelineMigrationMessage()
    : !queueReady
      ? "queue_not_ready: tabela schedule_job_tasks indisponível."
      : null;

  const withInfra = {
    ...status,
    pipelineMigrationRequired: !pipelineReady,
    queueNotReady: !queueReady,
    infrastructureError,
    recommendedAction: !pipelineReady
      ? PIPELINE_MIGRATION_REQUIRED
      : !queueReady
        ? "queue_not_ready"
        : status.recommendedAction,
  };

  if (consistency.postsInCalendar >= job.total_items && job.total_items > 0) {
    const insertChunksTotal = Math.ceil(job.total_items / SCHEDULE_JOB_INSERT_CHUNK);
    const insertChunksDone = Math.min(
      insertChunksTotal,
      Math.ceil(consistency.postsInCalendar / SCHEDULE_JOB_INSERT_CHUNK),
    );
    const alreadyCompleted =
      job.status === "completed" || job.status === "partial_failed";

    return {
      ...withInfra,
      postsInCalendar: consistency.postsInCalendar,
      canOpenCalendar: true,
      insertChunksDone,
      insertChunksTotal,
      recommendedAction: alreadyCompleted
        ? (withInfra.recommendedAction ?? "completed")
        : "reconcile_calendar",
    };
  }

  return withInfra;
}

export async function buildJobStatusForJob(
  supabase: SupabaseClient,
  job: ScheduleJobRow,
  items?: ScheduleJobItemRow[],
) {
  return buildJobStatusReadOnly(supabase, job, items);
}

export function buildJobStatus(
  job: ScheduleJobRow,
  items: ScheduleJobItemRow[],
): ScheduleJobStatusResponse {
  const completed = items.filter((item) => item.status === "completed").length;
  const failed = items.filter((item) => item.status === "failed").length;
  const planned = items.filter((item) => item.destinations?.length).length;

  return buildJobStatusFromJob({
    ...job,
    total_items: items.length,
    completed_items: completed,
    failed_items: failed,
    processed_items: planned,
  });
}

export async function finalizeJobStatusFromDb(
  supabase: SupabaseClient,
  job: ScheduleJobRow,
) {
  await repairSavePostsTaskConsistency(supabase, job.id);

  const counts = await syncJobCountersFromDb(supabase, job.id);
  const consistency = await loadJobConsistencySnapshot(supabase, job);
  const oldStatus = job.status;

  let status = job.status;
  let currentStep = job.current_step;
  let completedAt = job.completed_at;

  const allItemsAccountedFor =
    counts.completed + counts.failed === counts.total && counts.total > 0;
  const planComplete = counts.calendarDone >= counts.total;
  const postsSaved = counts.completed > 0;

  if (allItemsAccountedFor && postsSaved) {
    status =
      counts.failed > 0 ? "partial_failed" : "completed";
    currentStep = "completed";
    completedAt = completedAt ?? new Date().toISOString();
  } else if (allItemsAccountedFor && counts.failed === counts.total) {
    status = "failed";
    currentStep = "completed";
    completedAt = completedAt ?? new Date().toISOString();
  } else if (counts.captionDone < counts.total) {
    status = "processing";
    currentStep = "captions";
    completedAt = null;
  } else if (planComplete && counts.completed < counts.total) {
    status = "processing";
    currentStep = "inserting";
    completedAt = null;
  } else if (status === "completed" && !postsSaved) {
    status = "processing";
    currentStep = counts.captionDone < counts.total ? "captions" : "inserting";
    completedAt = null;
  }

  if (
    consistency.isInconsistent &&
    (status === "completed" || status === "partial_failed")
  ) {
    status = "processing";
    currentStep = "inserting";
    completedAt = null;
  }

  const errorMessage = consistency.isInconsistent
    ? consistency.errors.map((error) => error.message).join(" ")
    : job.error_message;

  await updateJobCounters(supabase, job.id, {
    completed_items: counts.completed,
    failed_items: counts.failed,
    processed_items: counts.calendarDone,
    status,
    current_step: currentStep,
    completed_at: completedAt,
    error_message: errorMessage,
  } as Partial<ScheduleJobRow>);

  const nextJob = {
    ...job,
    completed_items: counts.completed,
    failed_items: counts.failed,
    processed_items: counts.calendarDone,
    status,
    current_step: currentStep,
    completed_at: completedAt,
    error_message: errorMessage,
    updated_at: new Date().toISOString(),
  } as ScheduleJobRow;

  if (oldStatus !== status || job.current_step !== currentStep) {
    logScheduleJobEvent("schedule-job-state-transition", nextJob, {
      oldStatus,
      oldStep: job.current_step,
    });
  }

  if (status === "completed" || status === "partial_failed") {
    logScheduleJobEvent("schedule-job-completed", nextJob, { oldStatus });
  } else if (status === "failed") {
    logScheduleJobEvent("schedule-job-failed", nextJob, { oldStatus });
  } else {
    logScheduleJobEvent("schedule-job-progress", nextJob);
  }

  return nextJob;
}

export async function refreshJobStatusFromItems(
  supabase: SupabaseClient,
  job: ScheduleJobRow,
  items: ScheduleJobItemRow[],
) {
  const completed = items.filter((i) => i.status === "completed").length;
  const failed = items.filter((i) => i.status === "failed").length;
  const processed = items.filter((i) => i.destinations?.length).length;

  let status = job.status;
  let currentStep = job.current_step;
  let completedAt = job.completed_at;

  if (completed + failed === items.length && items.length > 0 && completed > 0) {
    status = failed > 0 ? "partial_failed" : "completed";
    currentStep = "completed";
    completedAt = completedAt ?? new Date().toISOString();
  } else if (completed + failed === items.length && failed === items.length) {
    status = "failed";
    currentStep = "completed";
    completedAt = completedAt ?? new Date().toISOString();
  } else if (processed < items.length) {
    status = "processing";
    currentStep = "captions";
  } else if (completed < items.length) {
    status = "processing";
    currentStep = "inserting";
  }

  await updateJobCounters(supabase, job.id, {
    completed_items: completed,
    failed_items: failed,
    processed_items: processed,
    status,
    current_step: currentStep,
    completed_at: completedAt,
  } as Partial<ScheduleJobRow>);

  return {
    ...job,
    completed_items: completed,
    failed_items: failed,
    processed_items: processed,
    status,
    current_step: currentStep,
    completed_at: completedAt,
  };
}
