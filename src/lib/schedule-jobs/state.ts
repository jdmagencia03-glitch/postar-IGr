import {
  SCHEDULE_JOB_INSERT_CHUNK,
  SCHEDULE_JOB_PLAN_CHUNK,
  SCHEDULE_JOB_SAVE_STALL_MS,
  SCHEDULE_JOB_STALE_MS,
  SCHEDULE_JOB_WORKER_ACTIVE_MS,
} from "@/lib/schedule-jobs/constants";
import type { ScheduleJobRow, ScheduleJobStatus } from "@/lib/schedule-jobs/types";

export type ScheduleJobPhase =
  | "queued"
  | "processing_captions"
  | "processing_hashtags"
  | "building_calendar"
  | "saving_posts"
  | "completed"
  | "partial_completed"
  | "failed"
  | "paused_connection"
  | "paused_needs_action"
  | "retrying"
  | "cancelled";

export type ScheduleStepId = "videos" | "captions" | "calendar" | "posts" | "done";
export type ScheduleStepState = "pending" | "active" | "done" | "error";

export type WorkerDisplayStatus = "processing" | "queued_next" | "stalled" | "idle";

export type ScheduleJobViewState = {
  phase: ScheduleJobPhase;
  captionsDone: number;
  hashtagsDone: number;
  calendarDone: number;
  postsSaved: number;
  pendingItems: number;
  planReady: boolean;
  planChunksTotal: number;
  planChunksDone: number;
  insertChunksTotal: number;
  insertChunksDone: number;
  headline: string;
  progressLabel: string;
  progressPercent: number;
  planSummaryLabel: string | null;
  postsSummaryLabel: string | null;
  stepLabel: string;
  isActive: boolean;
  workerActive: boolean;
  workerStatus: WorkerDisplayStatus;
  workerLabel: string;
  canResume: boolean;
  canForceContinue: boolean;
  canFinalizePosts: boolean;
  isStalled: boolean;
  canCancel: boolean;
  canOpenCalendar: boolean;
  hasActiveError: boolean;
  steps: Record<ScheduleStepId, ScheduleStepState>;
};

const TERMINAL_STATUSES = new Set<ScheduleJobStatus>([
  "completed",
  "partial_failed",
  "failed",
  "cancelled",
]);

export function isLockExpired(job: ScheduleJobRow) {
  if (!job.lock_until) return true;
  return new Date(job.lock_until).getTime() <= Date.now();
}

export function isWorkerActive(job: ScheduleJobRow) {
  if (!job.locked_by || !job.lock_until || isLockExpired(job)) return false;
  if (!job.last_heartbeat_at) return true;
  return Date.now() - new Date(job.last_heartbeat_at).getTime() < SCHEDULE_JOB_WORKER_ACTIVE_MS;
}

export function isJobStale(job: ScheduleJobRow) {
  const active = job.status === "queued" || job.status === "processing";
  if (!active || !job.updated_at) return false;
  return Date.now() - new Date(job.updated_at).getTime() > SCHEDULE_JOB_STALE_MS;
}

const QUEUED_NEXT_MS = 120_000;

export function deriveWorkerDisplay(job: ScheduleJobRow): {
  status: WorkerDisplayStatus;
  label: string;
} {
  const isActive = job.status === "queued" || job.status === "processing";
  if (!isActive) {
    return { status: "idle", label: "Inativo" };
  }
  if (isWorkerActive(job)) {
    return { status: "processing", label: "Processando chunk agora" };
  }
  if (isJobStale(job)) {
    return { status: "stalled", label: "Parado — aguardando retomada" };
  }
  const sinceUpdate = Date.now() - new Date(job.updated_at).getTime();
  if (sinceUpdate < QUEUED_NEXT_MS) {
    return { status: "queued_next", label: "Entre chunks — próximo ciclo em breve" };
  }
  return { status: "queued_next", label: "Aguardando próximo chunk" };
}

export function logScheduleJobEvent(
  event: string,
  job: ScheduleJobRow,
  extra?: Record<string, unknown>,
) {
  const planChunksTotal = Math.ceil(job.total_items / SCHEDULE_JOB_PLAN_CHUNK);
  const planChunksDone = Math.ceil(job.processed_items / SCHEDULE_JOB_PLAN_CHUNK);

  console.info(`[${event}]`, {
    jobId: job.id,
    accountId: job.account_id,
    uploadBatchId: job.upload_batch_id,
    oldStatus: extra?.oldStatus,
    newStatus: job.status,
    totalItems: job.total_items,
    captionsDone: job.processed_items,
    calendarDone: job.processed_items,
    postsSaved: job.completed_items,
    failedItems: job.failed_items,
    chunksDone: planChunksDone,
    chunksTotal: planChunksTotal,
    lastError: job.error_message,
    timestamp: new Date().toISOString(),
    ...extra,
  });
}

function derivePhase(job: ScheduleJobRow): ScheduleJobPhase {
  const { status, processed_items, completed_items, total_items, failed_items } = job;

  if (status === "cancelled") return "cancelled";
  if (status === "failed") return "failed";
  if (status === "completed") return "completed";
  if (status === "partial_failed") return "partial_completed";
  if (status === "queued") return "queued";

  if (isJobStale(job) && !isWorkerActive(job)) {
    return "paused_needs_action";
  }

  if (processed_items < total_items) {
    if (processed_items === 0) return "processing_captions";
    if (job.schedule_summary) return "building_calendar";
    return "processing_captions";
  }

  if (completed_items + failed_items < total_items) {
    return "saving_posts";
  }

  return "processing_captions";
}

function deriveSteps(
  job: ScheduleJobRow,
  phase: ScheduleJobPhase,
): Record<ScheduleStepId, ScheduleStepState> {
  const total = job.total_items;
  const captionsDone = job.processed_items;
  const calendarDone = job.processed_items;
  const postsSaved = job.completed_items;
  const hasFailed = job.failed_items > 0;

  const captions: ScheduleStepState =
    phase === "processing_captions" || phase === "processing_hashtags"
      ? "active"
      : captionsDone >= total
        ? "done"
        : captionsDone > 0
          ? "active"
          : hasFailed
            ? "error"
            : "pending";

  const calendar: ScheduleStepState =
    phase === "building_calendar"
      ? "active"
      : calendarDone >= total
        ? "done"
        : calendarDone > 0
          ? "active"
          : "pending";

  const posts: ScheduleStepState =
    phase === "saving_posts"
      ? "active"
      : postsSaved >= total && total > 0
        ? "done"
        : postsSaved > 0 && (phase === "partial_completed" || phase === "completed")
          ? "done"
          : hasFailed && calendarDone >= total && postsSaved === 0
            ? "error"
            : "pending";

  const done: ScheduleStepState =
    phase === "completed" || phase === "partial_completed"
      ? "done"
      : phase === "failed"
        ? "error"
        : "pending";

  return {
    videos: total > 0 ? "done" : "pending",
    captions,
    calendar,
    posts,
    done,
  };
}

function stepLabelForPhase(phase: ScheduleJobPhase): string {
  const labels: Record<ScheduleJobPhase, string> = {
    queued: "Preparando agendamento",
    processing_captions: "Criando legendas e hashtags",
    processing_hashtags: "Criando legendas e hashtags",
    building_calendar: "Montando calendário",
    saving_posts: "Salvando posts no calendário",
    completed: "Concluído",
    partial_completed: "Concluído parcialmente",
    failed: "Falhou",
    paused_connection: "Aguardando retomada",
    paused_needs_action: "Aguardando retomada",
    retrying: "Tentando novamente",
    cancelled: "Cancelado",
  };
  return labels[phase];
}

function headlineForPhase(phase: ScheduleJobPhase): string {
  const headlines: Record<ScheduleJobPhase, string> = {
    queued: "Agendamento iniciado…",
    processing_captions: "Preparando publicações…",
    processing_hashtags: "Preparando publicações…",
    building_calendar: "Montando calendário…",
    saving_posts: "Salvando posts no calendário…",
    completed: "Agendamento concluído",
    partial_completed: "Agendamento parcialmente concluído",
    failed: "Agendamento falhou",
    paused_connection: "Agendamento pausado",
    paused_needs_action: "Agendamento pausado",
    retrying: "Retomando agendamento",
    cancelled: "Agendamento cancelado",
  };
  return headlines[phase];
}

export function deriveScheduleJobView(job: ScheduleJobRow): ScheduleJobViewState {
  const total = job.total_items;
  const captionsDone = job.processed_items;
  const calendarDone = job.processed_items;
  const postsSaved = job.completed_items;
  const failed = job.failed_items;
  const pendingItems = Math.max(0, total - postsSaved - failed);
  const phase = derivePhase(job);
  const planReady = Boolean(job.schedule_summary);

  const planChunksTotal = Math.ceil(total / SCHEDULE_JOB_PLAN_CHUNK);
  const planChunksDone = Math.min(planChunksTotal, Math.ceil(captionsDone / SCHEDULE_JOB_PLAN_CHUNK));
  const insertChunksTotal = Math.ceil(total / SCHEDULE_JOB_INSERT_CHUNK);
  const insertChunksDone = Math.min(
    insertChunksTotal,
    Math.ceil(postsSaved / SCHEDULE_JOB_INSERT_CHUNK),
  );

  let progressPercent = 0;
  let progressLabel = "Preparando agendamento…";

  if (phase === "saving_posts" || postsSaved > 0) {
    progressLabel = `${postsSaved} de ${total} posts salvos no calendário`;
    progressPercent = total > 0 ? Math.round((postsSaved / total) * 100) : 0;
  } else if (total > 0) {
    progressLabel = `Legendas: ${captionsDone}/${total} · Calendário: ${calendarDone}/${total} · Chunks: ${planChunksDone}/${planChunksTotal}`;
    const itemProgress = (captionsDone / total) * 70;
    const chunkProgress =
      planChunksTotal > 0 ? (planChunksDone / planChunksTotal) * 30 : 0;
    progressPercent = Math.round(Math.min(99, itemProgress + chunkProgress));
  }

  const isActive = job.status === "queued" || job.status === "processing";
  const workerActive = isWorkerActive(job);
  const workerDisplay = deriveWorkerDisplay(job);
  const hasActiveError = Boolean(job.error_message) && !TERMINAL_STATUSES.has(job.status);

  const canResume =
    phase === "failed" ||
    phase === "paused_needs_action" ||
    (phase === "partial_completed" && failed > 0);

  const savingPostsStuck =
    phase === "saving_posts" &&
    calendarDone >= total &&
    postsSaved < total &&
    Date.now() - new Date(job.updated_at).getTime() > SCHEDULE_JOB_SAVE_STALL_MS;

  const isStalled =
    isActive &&
    !workerActive &&
    (isJobStale(job) || savingPostsStuck ||
      (Date.now() - new Date(job.updated_at).getTime() > SCHEDULE_JOB_STALE_MS && postsSaved < total));

  const canForceContinue = isStalled || phase === "paused_needs_action";
  const canFinalizePosts =
    (phase === "saving_posts" || (calendarDone >= total && postsSaved < total)) &&
    postsSaved < total;

  const canCancel = isActive && !workerActive;
  const canOpenCalendar =
    postsSaved > 0 || phase === "completed" || phase === "partial_completed";

  const planSummaryLabel = planReady
    ? `Plano criado: ${job.schedule_summary ?? `${total} vídeos distribuídos no calendário`}`
    : null;

  const postsSummaryLabel =
    postsSaved > 0 || phase === "completed" || phase === "partial_completed"
      ? `Posts salvos no calendário: ${postsSaved} de ${total}`
      : null;

  return {
    phase,
    captionsDone,
    hashtagsDone: captionsDone,
    calendarDone,
    postsSaved,
    pendingItems,
    planReady,
    planChunksTotal,
    planChunksDone,
    insertChunksTotal,
    insertChunksDone,
    headline: headlineForPhase(phase),
    progressLabel,
    progressPercent,
    planSummaryLabel,
    postsSummaryLabel,
    stepLabel: stepLabelForPhase(phase),
    isActive,
    workerActive,
    workerStatus: workerDisplay.status,
    workerLabel: workerDisplay.label,
    canResume,
    canForceContinue,
    canFinalizePosts,
    isStalled,
    canCancel,
    canOpenCalendar,
    hasActiveError,
    steps: deriveSteps(job, phase),
  };
}

export function isTerminalScheduleJobStatus(status: ScheduleJobStatus) {
  return TERMINAL_STATUSES.has(status);
}
