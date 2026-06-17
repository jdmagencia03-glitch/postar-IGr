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
  paused: boolean;
  resuming?: boolean;
}) {
  const { batch, progress, progressMap, running, paused, resuming = false } = params;
  const files = getUploadFiles(batch);
  const pendingFiles = files
    .filter((file) => file.status !== "completed")
    .sort((a, b) => a.sort_order - b.sort_order);
  const completedCount = progress?.completed ?? batch?.completed_files ?? 0;
  const totalCount = progress?.total ?? batch?.total_files ?? files.length;
  const failedCount = progress?.failed ?? batch?.failed_files ?? 0;
  const pendingCount = pendingFiles.length;
  const canContinue = Boolean(batch && batch.status !== "ready" && !running && pendingCount > 0);
  const uploadInterrupted = canContinue && !paused;
  const uploadPaused = canContinue && paused;
  const overallPercent =
    progress?.overallPercent ?? (totalCount ? Math.round((completedCount / totalCount) * 100) : 0);

  const visibleFiles = files
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order)
    .filter(
      (file) =>
        file.status === "uploading" ||
        file.status === "failed" ||
        file.status === "pending" ||
        (progressMap[file.id] ?? 0) > 0,
    );
  const completedOnlyFiles = files
    .filter((file) => file.status === "completed")
    .sort((a, b) => a.sort_order - b.sort_order);

  const sorted = [...files].sort((a, b) => a.sort_order - b.sort_order);
  const inProgress = sorted.filter(
    (file) => file.status === "uploading" || file.status === "failed" || file.status === "pending",
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

  const statusLabel = running
    ? "enviando"
    : batch?.status === "ready"
      ? "concluído"
      : failedCount > 0 && !running
        ? "erro"
        : canContinue
          ? "aguardando"
          : "enviando";

  const hasIncomplete =
    Boolean(batch) &&
    batch!.status !== "ready" &&
    files.some((file) => file.status !== "completed");

  const showGlobalBar = Boolean(batch && (running || resuming || hasIncomplete));

  return {
    files,
    pendingFiles,
    completedCount,
    totalCount,
    failedCount,
    pendingCount,
    canContinue,
    uploadInterrupted,
    uploadPaused,
    overallPercent,
    listFiles,
    currentUploadName,
    statusLabel,
    showGlobalBar,
    remainingCount: Math.max(0, totalCount - completedCount),
  };
}
