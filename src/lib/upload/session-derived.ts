import type { UploadBatch, UploadBatchFile } from "@/lib/types";
import type { UploadEngineProgress } from "@/lib/upload/engine";

export function getUploadFiles(batch: UploadBatch | null) {
  return batch?.upload_files?.filter((file) => !file.removed) ?? [];
}

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
  } = params;
  const files = getUploadFiles(batch);
  const pendingFiles = files
    .filter((file) => file.status !== "completed")
    .sort((a, b) => a.sort_order - b.sort_order);
  const completedCount = progress?.completed ?? batch?.completed_files ?? 0;
  const totalCount = progress?.total ?? batch?.total_files ?? files.length;
  const failedCount = progress?.failed ?? batch?.failed_files ?? 0;
  const pendingCount = pendingFiles.length;
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
      !resuming,
  );
  const hasFileRetry = Object.values(fileRuntime).some((runtime) => runtime.status === "retrying");
  const autoRecovering = Boolean(
    awaitingAutoRecovery || retrying || hasFileRetry || (running && !pausedByUser && canResumeWithoutPicker),
  );
  const overallPercent =
    progress?.overallPercent ?? (totalCount ? Math.round((completedCount / totalCount) * 100) : 0);

  const visibleFiles = files
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order)
    .filter(
      (file) =>
        file.status === "uploading" ||
        file.status === "retrying" ||
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
      file.status === "failed" ||
      file.status === "pending",
  );
  const recentCompleted = sorted.filter((file) => file.status === "completed").slice(-8);

  let listFiles: UploadBatchFile[];
  if (batch?.status !== "ready") {
    const seen = new Set(inProgress.map((file) => file.id));
    listFiles = [...inProgress, ...recentCompleted.filter((file) => !seen.has(file.id))];
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

  const statusLabel = retrying || awaitingAutoRecovery
    ? "reconectando"
    : running
      ? "enviando"
      : batch?.status === "ready"
        ? "concluído"
        : failedCount > 0 && !running && !retrying && !autoRecovering
          ? "erro"
          : pausedByUser
            ? "pausado"
            : canSelectFiles
              ? "aguardando"
              : pendingCount > 0
                ? "reconectando"
                : "aguardando";

  const hasIncomplete =
    Boolean(batch) &&
    batch!.status !== "ready" &&
    files.some((file) => file.status !== "completed");

  const showGlobalBar = Boolean(batch && (running || retrying || resuming || hasIncomplete));

  return {
    files,
    pendingFiles,
    completedCount,
    totalCount,
    failedCount,
    pendingCount,
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
    remainingCount: Math.max(0, totalCount - completedCount),
    retrying,
    pausedByUser,
    canRetryFailed,
  };
}
