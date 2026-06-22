import type { UploadBatch, UploadBatchFile } from "@/lib/types";
import type { UploadEngineProgress } from "@/lib/upload/engine";
import { buildSpeedDisplay } from "@/lib/upload/adaptive";
import { getFileDisplayPercent } from "@/lib/upload/batch-status";
import { isUploadDebugEnabled } from "@/lib/upload/debug";
import {
  applyMonotonicBatchProgress,
  resetProgressGuardForBatch,
  validateBatchProgressEvent,
} from "@/lib/upload/progress-guard";
import { formatBytes } from "@/lib/upload/validate";

export type UploadFileStatusCounts = {
  uploading: number;
  retrying: number;
  stalled: number;
  pending: number;
  completed: number;
  failed: number;
};

export type GetUploadBatchStatsOptions = {
  progressMap?: Record<string, number>;
  progress?: UploadEngineProgress | null;
  /** Aplica progresso monotônico por lote (padrão: true). */
  monotonic?: boolean;
};

export type UploadBatchStats = {
  batchId: string | null;
  totalFiles: number;
  completedFiles: number;
  failedFiles: number;
  pendingFiles: number;
  uploadingFiles: number;
  retryingFiles: number;
  stalledFiles: number;
  totalBytes: number;
  completedBytes: number;
  activeUploadedBytes: number;
  displayUploadedBytes: number;
  pendingBytes: number;
  progressPercent: number;
  currentSpeed: number;
  estimatedRemainingTime: number | null;
  headlineText: string;
  statusCounterText: string;
  bytesSummaryText: string;
  speedSummaryText: string;
  etaSummaryText: string;
  hasActiveByteProgress: boolean;
  hasActiveUploads: boolean;
};

export function getUploadFiles(batch: UploadBatch | null) {
  return batch?.upload_files?.filter((file) => !file.removed) ?? [];
}

export function countUploadFilesByStatus(files: UploadBatchFile[]): UploadFileStatusCounts {
  let uploading = 0;
  let retrying = 0;
  let stalled = 0;
  let pending = 0;
  let completed = 0;
  let failed = 0;

  for (const file of files) {
    switch (file.status) {
      case "uploading":
        uploading += 1;
        break;
      case "retrying":
        retrying += 1;
        break;
      case "stalled":
        stalled += 1;
        break;
      case "completed":
        completed += 1;
        break;
      case "failed":
        failed += 1;
        break;
      default:
        pending += 1;
        break;
    }
  }

  return { uploading, retrying, stalled, pending, completed, failed };
}

export function formatBatchStatusSummary(counts: {
  completed: number;
  failed: number;
  pending: number;
  uploading?: number;
  retrying?: number;
  stalled?: number;
}) {
  const parts: string[] = [`${counts.completed} enviados`];
  if (counts.failed > 0) parts.push(`${counts.failed} falharam`);
  parts.push(`${counts.pending} pendentes`);
  if ((counts.uploading ?? 0) > 0) parts.push(`${counts.uploading} enviando`);
  if ((counts.retrying ?? 0) > 0) parts.push(`${counts.retrying} em retry`);
  if ((counts.stalled ?? 0) > 0) parts.push(`${counts.stalled} travados`);
  return parts.join(" · ");
}

function getFileActiveUploadedBytes(
  file: UploadBatchFile,
  progressMap: Record<string, number>,
): number {
  const size = Number(file.file_size) || 0;
  if (!size) return 0;
  if (file.status === "completed") return size;
  if (file.status === "failed" || file.status === "pending") return 0;

  const percent = getFileDisplayPercent(file, progressMap);
  if (percent > 0) return Math.round((percent / 100) * size);
  return Number(file.bytes_uploaded ?? 0);
}

function computeByteTotals(files: UploadBatchFile[], progressMap: Record<string, number>) {
  let totalBytes = 0;
  let completedBytes = 0;
  let activeUploadedBytes = 0;

  for (const file of files) {
    const size = Number(file.file_size) || 0;
    totalBytes += size;

    if (file.status === "completed") {
      completedBytes += size;
      continue;
    }

    if (file.status === "uploading" || file.status === "retrying" || file.status === "stalled") {
      activeUploadedBytes += getFileActiveUploadedBytes(file, progressMap);
    }
  }

  const displayUploadedBytes = completedBytes + activeUploadedBytes;
  const pendingBytes = Math.max(0, totalBytes - displayUploadedBytes);

  return { totalBytes, completedBytes, activeUploadedBytes, displayUploadedBytes, pendingBytes };
}

function computeProgressPercent(params: {
  totalBytes: number;
  displayUploadedBytes: number;
  totalFiles: number;
  completedFiles: number;
}) {
  if (params.totalBytes > 0) {
    return Math.min(100, Math.round((params.displayUploadedBytes / params.totalBytes) * 100));
  }
  if (params.totalFiles > 0) {
    return Math.min(100, Math.round((params.completedFiles / params.totalFiles) * 100));
  }
  return 0;
}

function applyMonotonicProgress(batchId: string, computedPercent: number, computedBytes: number) {
  return applyMonotonicBatchProgress(batchId, computedPercent, computedBytes, {
    source: "getUploadBatchStats",
  });
}

export function resetUploadBatchStatsMonotonic(batchId: string) {
  resetProgressGuardForBatch(batchId);
}

export function logUploadStats(payload: Record<string, unknown>) {
  if (!isUploadDebugEnabled()) return;
  console.info("[upload-stats]", payload);
}

export function logUploadProgressRegression(payload: Record<string, unknown>) {
  if (!isUploadDebugEnabled()) return;
  console.info("[upload-progress-regression]", payload);
}

export function logUploadStatsReconcile(payload: Record<string, unknown>) {
  if (!isUploadDebugEnabled()) return;
  console.info("[upload-stats-reconcile]", payload);
}

export function getUploadBatchStats(
  batch: UploadBatch | null,
  options: GetUploadBatchStatsOptions = {},
): UploadBatchStats {
  const progressMap = options.progressMap ?? {};
  const progress = options.progress ?? null;
  const monotonic = options.monotonic ?? true;

  if (!batch) {
    return emptyUploadBatchStats();
  }

  const files = getUploadFiles(batch);
  const statusCounts = countUploadFilesByStatus(files);
  const hasFileList = files.length > 0;

  const totalFiles = hasFileList ? files.length : batch.total_files ?? 0;
  const completedFiles = hasFileList ? statusCounts.completed : batch.completed_files ?? 0;
  const failedFiles = hasFileList ? statusCounts.failed : batch.failed_files ?? 0;
  const pendingFiles = hasFileList
    ? statusCounts.pending
    : Math.max(0, totalFiles - completedFiles - failedFiles);
  const uploadingFiles = hasFileList ? statusCounts.uploading : 0;
  const retryingFiles = hasFileList ? statusCounts.retrying : 0;
  const stalledFiles = hasFileList ? statusCounts.stalled : 0;

  if (hasFileList) {
    if (batch.completed_files !== statusCounts.completed || batch.failed_files !== statusCounts.failed) {
      logUploadStatsReconcile({
        batchId: batch.id,
        totalFiles,
        completedFiles: statusCounts.completed,
        failedFiles: statusCounts.failed,
        pendingFiles: statusCounts.pending,
        batchCompletedFiles: batch.completed_files,
        batchFailedFiles: batch.failed_files,
        source: "file_list_vs_batch_counters",
      });
    }
  }

  const byteTotals = hasFileList
    ? computeByteTotals(files, progressMap)
    : {
        totalBytes: 0,
        completedBytes: 0,
        activeUploadedBytes: 0,
        displayUploadedBytes: 0,
        pendingBytes: 0,
      };

  let progressPercent = computeProgressPercent({
    totalBytes: byteTotals.totalBytes,
    displayUploadedBytes: byteTotals.displayUploadedBytes,
    totalFiles,
    completedFiles,
  });

  let displayUploadedBytes = byteTotals.displayUploadedBytes;

  if (monotonic && batch.id && validateBatchProgressEvent(batch.id)) {
    const monotonicResult = applyMonotonicProgress(
      batch.id,
      progressPercent,
      displayUploadedBytes,
    );
    progressPercent = monotonicResult.progressPercent;
    displayUploadedBytes = monotonicResult.displayUploadedBytes;
  }

  const hasActiveUploads =
    uploadingFiles + retryingFiles + stalledFiles > 0 ||
    Boolean(progress?.hasActiveUploads ?? progress?.uploading);

  const speedDisplay = buildSpeedDisplay({
    speedBps30s: progress?.speedBps30s ?? progress?.speedBps ?? 0,
    speedBps2m: progress?.speedBps2m ?? 0,
    etaSeconds: progress?.etaSeconds ?? 0,
    hasActiveUploads,
    hasByteProgress: progress?.hasByteProgress ?? progressPercent > 0,
  });

  const currentSpeed = speedDisplay.speedBps;
  const estimatedRemainingTime =
    speedDisplay.speedLabel === "normal" && speedDisplay.etaSeconds > 0
      ? speedDisplay.etaSeconds
      : null;

  const headlineText =
    totalFiles > 0
      ? `${completedFiles} de ${totalFiles} vídeos enviados`
      : "Nenhum vídeo no lote";

  const statusCounterText = formatBatchStatusSummary({
    completed: completedFiles,
    failed: failedFiles,
    pending: pendingFiles,
    uploading: uploadingFiles,
    retrying: retryingFiles,
    stalled: stalledFiles,
  });

  let bytesSummaryText = "—";
  if (byteTotals.totalBytes > 0) {
    if (byteTotals.activeUploadedBytes > 0) {
      bytesSummaryText = `${formatBytes(byteTotals.completedBytes)} confirmados · ${formatBytes(byteTotals.activeUploadedBytes)} em envio agora · ${formatBytes(byteTotals.totalBytes)} total`;
    } else {
      bytesSummaryText = `${formatBytes(byteTotals.completedBytes)} enviados de ${formatBytes(byteTotals.totalBytes)} totais`;
    }
  }

  let speedSummaryText = "Sem progresso no momento — verificando conexão…";
  if (speedDisplay.speedLabel === "calculating") {
    speedSummaryText = "Calculando velocidade…";
  } else if (speedDisplay.speedLabel === "normal" && currentSpeed > 0) {
    speedSummaryText = `Velocidade atual: ${formatBytes(currentSpeed)}/s`;
  } else if (!hasActiveUploads && completedFiles >= totalFiles && totalFiles > 0) {
    speedSummaryText = "Upload concluído";
  }

  let etaSummaryText = "Calculando tempo restante…";
  if (speedDisplay.etaLabel !== "—" && speedDisplay.etaLabel !== "calculando…") {
    etaSummaryText = speedDisplay.etaLabel;
  } else if (speedDisplay.speedLabel === "no_progress") {
    etaSummaryText = "Sem progresso detectado";
  }

  return {
    batchId: batch.id,
    totalFiles,
    completedFiles,
    failedFiles,
    pendingFiles,
    uploadingFiles,
    retryingFiles,
    stalledFiles,
    totalBytes: byteTotals.totalBytes,
    completedBytes: byteTotals.completedBytes,
    activeUploadedBytes: byteTotals.activeUploadedBytes,
    displayUploadedBytes,
    pendingBytes: byteTotals.pendingBytes,
    progressPercent,
    currentSpeed,
    estimatedRemainingTime,
    headlineText,
    statusCounterText,
    bytesSummaryText,
    speedSummaryText,
    etaSummaryText,
    hasActiveByteProgress: speedDisplay.speedLabel === "normal" && currentSpeed > 0,
    hasActiveUploads,
  };
}

function emptyUploadBatchStats(): UploadBatchStats {
  return {
    batchId: null,
    totalFiles: 0,
    completedFiles: 0,
    failedFiles: 0,
    pendingFiles: 0,
    uploadingFiles: 0,
    retryingFiles: 0,
    stalledFiles: 0,
    totalBytes: 0,
    completedBytes: 0,
    activeUploadedBytes: 0,
    displayUploadedBytes: 0,
    pendingBytes: 0,
    progressPercent: 0,
    currentSpeed: 0,
    estimatedRemainingTime: null,
    headlineText: "Nenhum vídeo no lote",
    statusCounterText: "0 enviados · 0 pendentes",
    bytesSummaryText: "—",
    speedSummaryText: "Sem progresso no momento — verificando conexão…",
    etaSummaryText: "Calculando tempo restante…",
    hasActiveByteProgress: false,
    hasActiveUploads: false,
  };
}
