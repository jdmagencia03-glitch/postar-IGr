import type { UploadBatch, UploadBatchFile } from "@/lib/types";
import type { UploadEngineProgress } from "@/lib/upload/engine";
import {
  countUploadFilesByStatus,
  formatBatchStatusSummary,
  getUploadBatchStats,
  getUploadFiles,
} from "@/lib/upload/batch-stats";

export { countUploadFilesByStatus, formatBatchStatusSummary, getUploadFiles };

export function deriveUploadSessionView(params: {
  batch: UploadBatch | null;
  progress: UploadEngineProgress | null;
  progressMap: Record<string, number>;
  running: boolean;
  pausedByUser: boolean;
  /** @deprecated use pausedByUser */
  paused?: boolean;
  retrying?: boolean;
  resuming?: boolean;
  canResumeWithoutPicker?: boolean;
  needsFileReselection?: boolean;
  fileRuntime?: Record<string, { status?: string }>;
  engineStarting?: boolean;
  recoveringFromStall?: boolean;
  batchStalled?: boolean;
}) {
  const {
    batch,
    progress,
    progressMap,
    running,
    pausedByUser = params.paused ?? false,
    retrying = false,
    resuming = false,
    canResumeWithoutPicker = false,
    needsFileReselection = false,
    fileRuntime = {},
    engineStarting = false,
    recoveringFromStall = false,
    batchStalled = false,
  } = params;

  const stats = getUploadBatchStats(batch, { progressMap, progress, monotonic: true });
  const files = getUploadFiles(batch);

  const pendingFiles = files
    .filter((file) => file.status !== "completed")
    .sort((a, b) => a.sort_order - b.sort_order);

  const completedCount = stats.completedFiles;
  const totalCount = stats.totalFiles;
  const failedCount = stats.failedFiles;
  const uploadingCount = stats.uploadingFiles;
  const retryingCount = stats.retryingFiles;
  const stalledCount = stats.stalledFiles;
  const pendingCount =
    stats.pendingFiles + uploadingCount + retryingCount + stalledCount;
  const queuePendingCount = stats.pendingFiles;
  const statusCounterText = stats.statusCounterText;
  const overallPercent = stats.progressPercent;

  /** Botão Retomar — somente após pausa manual do usuário. */
  const canResume = Boolean(
    batch && batch.status !== "ready" && !running && !retrying && pausedByUser && pendingCount > 0,
  );
  /** Seletor de arquivos — sessão perdeu referência aos File objects no navegador. */
  const canSelectFiles = Boolean(
    batch && batch.status !== "ready" && !running && !retrying && needsFileReselection && pendingCount > 0,
  );
  /** Sistema recuperando sozinho (arquivos ainda na sessão, sem pausa manual). */
  const awaitingAutoRecovery = Boolean(
    batch &&
      batch.status !== "ready" &&
      !pausedByUser &&
      !needsFileReselection &&
      canResumeWithoutPicker &&
      pendingCount > 0 &&
      !running &&
      !retrying &&
      !resuming &&
      !engineStarting &&
      !recoveringFromStall,
  );
  const hasFileRetry = Object.values(fileRuntime).some((runtime) => runtime.status === "retrying");
  const isActivelyUploading = running || engineStarting || recoveringFromStall;
  const autoRecovering = Boolean(
    awaitingAutoRecovery || retrying || hasFileRetry || (isActivelyUploading && !pausedByUser && canResumeWithoutPicker),
  );

  const visibleFiles = files
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order)
    .filter(
      (file) =>
        file.status === "uploading" ||
        file.status === "retrying" ||
        file.status === "stalled" ||
        file.status === "failed" ||
        file.status === "pending" ||
        (progressMap[file.id] ?? 0) > 0,
    );
  const completedOnlyFiles = files
    .filter((file) => file.status === "completed")
    .sort((a, b) => a.sort_order - b.sort_order);

  const sorted = [...files].sort((a, b) => a.sort_order - b.sort_order);
  const inProgress = sorted.filter(
    (file) =>
      file.status === "uploading" ||
      file.status === "retrying" ||
      file.status === "stalled" ||
      file.status === "failed" ||
      file.status === "pending",
  );
  const recentCompleted = sorted.filter((file) => file.status === "completed").slice(-8);

  let listFiles: UploadBatchFile[];
  if (batch?.status !== "ready") {
    const seen = new Set(inProgress.map((file) => file.id));
    const active = inProgress.filter(
      (file) =>
        file.status === "uploading" || file.status === "retrying" || file.status === "stalled",
    );
    const failedFiles = inProgress.filter((file) => file.status === "failed");
    const waiting = inProgress.filter((file) => file.status === "pending");
    const listLimit = totalCount > 50 ? 20 : 40;
    const activeSlice = active.slice(0, Math.min(8, listLimit));
    const failedSlice = failedFiles.slice(0, Math.min(4, listLimit - activeSlice.length));
    const waitingSlice = waiting.slice(
      0,
      Math.max(0, listLimit - activeSlice.length - failedSlice.length),
    );
    const compactInProgress = [...activeSlice, ...failedSlice, ...waitingSlice];
    const compactSeen = new Set(compactInProgress.map((file) => file.id));
    listFiles = [
      ...compactInProgress,
      ...recentCompleted.filter((file) => !compactSeen.has(file.id) && !seen.has(file.id)),
    ];
  } else if (visibleFiles.length > 0) {
    listFiles = visibleFiles;
  } else {
    listFiles = completedOnlyFiles.slice(-20);
  }

  const currentUploadName =
    progress?.activeFiles[0]?.filename ??
    pendingFiles.find((file) => file.status === "uploading")?.filename ??
    null;

  const canRetryFailed = Boolean(
    batch && batch.status !== "ready" && !running && !retrying && failedCount > 0,
  );

  const queueRemaining = Math.max(0, totalCount - completedCount - failedCount);

  const showRecoverButton = Boolean(
    batch &&
      batch.status !== "ready" &&
      !pausedByUser &&
      canResumeWithoutPicker &&
      queueRemaining > 0 &&
      (batchStalled ||
        recoveringFromStall ||
        (awaitingAutoRecovery && !isActivelyUploading && !hasFileRetry)),
  );

  const statusLabel = retrying
    ? "tentando_novamente"
    : recoveringFromStall || batchStalled
      ? "recuperando"
      : engineStarting || running || awaitingAutoRecovery
        ? "enviando"
        : batch?.status === "ready"
          ? "concluído"
          : failedCount > 0 && !isActivelyUploading && !retrying && !autoRecovering
            ? "erro"
            : pausedByUser
              ? "pausado"
              : canSelectFiles
                ? "aguardando"
                : "aguardando";

  const hasIncomplete =
    Boolean(batch) &&
    batch!.status !== "ready" &&
    files.some((file) => file.status !== "completed");

  const isEmptyBatch = Boolean(
    batch &&
      batch.status === "uploading" &&
      totalCount === 0 &&
      files.length === 0,
  );

  /** Lote criado sem vídeos — usuário pode selecionar arquivos agora. */
  const canAddVideosToBatch = Boolean(isEmptyBatch || canSelectFiles);

  const showGlobalBar = Boolean(
    batch &&
      (running || retrying || resuming || hasIncomplete) &&
      !isEmptyBatch,
  );

  return {
    stats,
    files,
    pendingFiles,
    completedCount,
    totalCount,
    failedCount,
    pendingCount,
    uploadingCount,
    retryingCount,
    stalledCount,
    queuePendingCount,
    statusCounterText,
    headlineText: stats.headlineText,
    bytesSummaryText: stats.bytesSummaryText,
    speedSummaryText: stats.speedSummaryText,
    etaSummaryText: stats.etaSummaryText,
    canResume,
    canSelectFiles,
    autoRecovering,
    awaitingAutoRecovery,
    /** @deprecated use canResume */
    canContinue: canResume || canSelectFiles,
    /** @deprecated */
    uploadInterrupted: false,
    /** @deprecated use canResume */
    uploadPaused: canResume,
    overallPercent,
    listFiles,
    currentUploadName,
    statusLabel,
    showGlobalBar,
    remainingCount: queueRemaining,
    queueRemaining,
    showRecoverButton,
    retrying,
    pausedByUser,
    canRetryFailed,
    isActivelyUploading,
    engineStarting,
    recoveringFromStall,
    batchStalled,
    isEmptyBatch,
    canAddVideosToBatch,
  };
}
