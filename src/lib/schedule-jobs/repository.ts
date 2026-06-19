import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  ScheduleJobConfig,
  ScheduleJobItemRow,
  ScheduleJobRow,
  ScheduleJobStatusResponse,
} from "@/lib/schedule-jobs/types";
import {
  SCHEDULE_JOB_INSERT_CHUNK,
  SCHEDULE_JOB_PLAN_CHUNK,
} from "@/lib/schedule-jobs/constants";

function mapItem(row: Record<string, unknown>): ScheduleJobItemRow {
  return {
    ...(row as ScheduleJobItemRow),
    media_urls: Array.isArray(row.media_urls) ? (row.media_urls as string[]) : [],
    destinations: row.destinations as ScheduleJobItemRow["destinations"],
  };
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
    const loaded = await getScheduleJob(supabase, params.ownerId, existing.id);
    if (loaded) return loaded;
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

  const { error: itemsError } = await supabase.from("schedule_job_items").insert(itemRows);
  if (itemsError) {
    await supabase.from("schedule_jobs").delete().eq("id", job.id);
    throw new Error(itemsError.message);
  }

  return getScheduleJob(supabase, params.ownerId, job.id);
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

export async function updateJobItem(
  supabase: SupabaseClient,
  itemId: string,
  patch: Record<string, unknown>,
) {
  const { error } = await supabase
    .from("schedule_job_items")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", itemId);

  if (error) throw new Error(error.message);
}

export function buildJobStatus(
  job: ScheduleJobRow,
  items: ScheduleJobItemRow[],
): ScheduleJobStatusResponse {
  const completed = items.filter((item) => item.status === "completed").length;
  const failed = items.filter((item) => item.status === "failed").length;
  const planned = items.filter((item) => item.destinations?.length).length;
  const pending = items.length - completed - failed;
  const planChunksTotal = Math.ceil(items.length / SCHEDULE_JOB_PLAN_CHUNK);
  const planChunksDone = Math.ceil(planned / SCHEDULE_JOB_PLAN_CHUNK);
  const insertChunksTotal = Math.ceil(items.length / SCHEDULE_JOB_INSERT_CHUNK);
  const inserted = items.filter(
    (item) =>
      item.status === "completed" ||
      (item.destinations?.every((d) => d.created_post_id) ?? false),
  ).length;
  const insertChunksDone = Math.ceil(inserted / SCHEDULE_JOB_INSERT_CHUNK);

  const stepLabels: Record<string, string> = {
    queued: "Preparando agendamento",
    planning: "Montando calendário",
    captions: "Criando legendas e hashtags",
    inserting: "Salvando posts",
    completed: "Concluído",
  };

  const isActive = job.status === "queued" || job.status === "processing";

  return {
    jobId: job.id,
    status: job.status,
    currentStep: job.current_step,
    total: items.length,
    processed: planned,
    completed,
    failed,
    pending,
    planChunksTotal,
    planChunksDone,
    insertChunksTotal,
    insertChunksDone,
    scheduleSummary: job.schedule_summary,
    errorMessage: job.error_message,
    isActive,
    canResume: job.status === "partial_failed" || failed > 0,
    stepLabel: stepLabels[job.current_step] ?? job.current_step,
  };
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

  if (completed + failed === items.length && items.length > 0) {
    status = failed > 0 && completed > 0 ? "partial_failed" : failed === items.length ? "failed" : "completed";
    currentStep = "completed";
    completedAt = new Date().toISOString();
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
