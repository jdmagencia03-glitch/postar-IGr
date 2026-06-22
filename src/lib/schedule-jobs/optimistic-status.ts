import type { ScheduleJobStatusResponse } from "@/lib/schedule-jobs/types";

/** UI otimista antes do primeiro status do servidor. */
export function buildOptimisticScheduleJobStatus(
  jobId: string,
  videoCount: number,
): ScheduleJobStatusResponse {
  const now = new Date().toISOString();
  return {
    jobId,
    status: "queued",
    phase: "queued",
    currentStep: "queued",
    total: videoCount,
    processed: 0,
    completed: 0,
    failed: 0,
    pending: videoCount,
    captionsDone: 0,
    hashtagsDone: 0,
    calendarDone: 0,
    postsSaved: 0,
    planChunksTotal: Math.max(1, Math.ceil(videoCount / 50)),
    planChunksDone: 0,
    insertChunksTotal: Math.max(1, Math.ceil(videoCount / 50)),
    insertChunksDone: 0,
    scheduleSummary: null,
    planReady: false,
    errorMessage: null,
    isActive: true,
    workerActive: false,
    workerStatus: "queued_next",
    workerLabel: "Iniciando…",
    canResume: false,
    canForceContinue: false,
    canFinalizePosts: false,
    isStalled: false,
    canCancel: true,
    canOpenCalendar: false,
    hasActiveError: false,
    lastHeartbeatAt: null,
    lastError: null,
    stepLabel: "Preparando publicações",
    headline: "Agendamento iniciado…",
    progressLabel: "Preparando publicações…",
    progressPercent: 5,
    planSummaryLabel: null,
    postsSummaryLabel: null,
    steps: {
      videos: "done",
      captions: "active",
      calendar: "pending",
      posts: "pending",
      done: "pending",
    },
    updatedAt: now,
    timing: {
      createdAt: now,
      startedAt: null,
      completedAt: null,
      durationMs: null,
      queueWaitMs: null,
      processingMs: null,
      chunks: [],
    },
    batchId: null,
    scheduleMode: "warmup",
    warmupPattern: null,
    skippedPastSlots: [],
    plannedPosts: [],
    stalledReason: null,
    recommendedAction: null,
    missingPosts: videoCount,
  };
}

export function isScheduleJobTerminal(status: ScheduleJobStatusResponse | null) {
  if (!status) return false;
  return (
    status.phase === "completed" ||
    status.phase === "partial_completed" ||
    status.phase === "failed" ||
    status.phase === "cancelled"
  );
}

export function shouldPollScheduleJob(status: ScheduleJobStatusResponse | null) {
  if (!status) return true;
  if (isScheduleJobTerminal(status)) return false;
  return status.isActive || status.phase === "queued";
}
