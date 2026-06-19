import type { UploadBatch, UploadBatchStatus, UploadFileStatus } from "@/lib/types";

/** Status agregado do lote para polling leve. */
export type UploadBatchRemoteAggregateStatus =
  | "active"
  | "completed"
  | "partial_failed"
  | "failed"
  | "cancelled";

export type UploadBatchRemoteFileStatus = {
  fileId: string;
  filename: string;
  status: UploadFileStatus;
  progress: number;
  errorMessage?: string | null;
  updatedAt: string;
};

export type UploadBatchRemoteStatus = {
  batchId: string;
  status: UploadBatchRemoteAggregateStatus;
  totalFiles: number;
  completed: number;
  failed: number;
  uploading: number;
  retrying: number;
  stalled: number;
  pending: number;
  progress: number;
  updatedAt: string;
  paused: boolean;
  files: UploadBatchRemoteFileStatus[];
};

export function mapRemoteAggregateToBatchStatus(
  status: UploadBatchRemoteAggregateStatus,
): UploadBatchStatus {
  switch (status) {
    case "completed":
    case "partial_failed":
    case "failed":
      return "ready";
    case "cancelled":
      return "cancelled";
    default:
      return "uploading";
  }
}

export function isTerminalRemoteBatchStatus(status: UploadBatchRemoteAggregateStatus) {
  return status === "completed" || status === "partial_failed" || status === "failed" || status === "cancelled";
}

export function isTerminalFileStatus(status: UploadFileStatus) {
  return status === "completed" || status === "failed";
}

export function batchNeedsPolling(batch: UploadBatch | null) {
  if (!batch) return false;
  if (batch.status === "ready" || batch.status === "cancelled") return false;
  const files = batch.upload_files ?? [];
  if (!files.length) return batch.status === "uploading";
  return files.some((file) => !file.removed && !isTerminalFileStatus(file.status));
}

export type ReconcileUploadBatchResult = {
  batch: UploadBatch;
  progressMap: Record<string, number>;
  changedFiles: number;
  batchStatusChanged: boolean;
  localStatusSummary: string;
  remoteStatusSummary: string;
};

function localStatusSummary(batch: UploadBatch | null) {
  if (!batch) return "none";
  const files = (batch.upload_files ?? []).filter((f) => !f.removed);
  const counts = files.reduce(
    (acc, file) => {
      acc[file.status] = (acc[file.status] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );
  return `${batch.status}:${JSON.stringify(counts)}`;
}

function remoteStatusSummary(remote: UploadBatchRemoteStatus) {
  return `${remote.status}:c${remote.completed}/f${remote.failed}/u${remote.uploading}/r${remote.retrying}/p${remote.pending}`;
}

/** Aplica estado remoto na store local, criando novas referências. */
export function reconcileUploadBatchState(
  localBatch: UploadBatch,
  remote: UploadBatchRemoteStatus,
  currentProgressMap: Record<string, number>,
): ReconcileUploadBatchResult {
  const remoteById = new Map(remote.files.map((file) => [file.fileId, file]));
  let changedFiles = 0;

  const nextProgress: Record<string, number> = { ...currentProgressMap };
  const localFiles = localBatch.upload_files ?? [];

  const nextFiles =
    localFiles.length > 0
      ? localFiles.map((localFile) => {
          if (localFile.removed) return localFile;
          const remoteFile = remoteById.get(localFile.id);
          if (!remoteFile) return localFile;

          const remoteUpdatedAt = new Date(remoteFile.updatedAt).getTime();
          const localUpdatedAt = new Date(localFile.updated_at).getTime();
          const nextBytes = Math.round((remoteFile.progress / 100) * Number(localFile.file_size));
          const statusChanged = localFile.status !== remoteFile.status;
          const progressChanged =
            (nextProgress[localFile.id] ?? 0) !== remoteFile.progress ||
            Number(localFile.bytes_uploaded ?? 0) !== nextBytes;
          const errorChanged =
            (localFile.error_message ?? null) !== (remoteFile.errorMessage ?? null);
          const remoteIsNewer = remoteUpdatedAt > localUpdatedAt;

          if (!statusChanged && !progressChanged && !errorChanged && !remoteIsNewer) {
            return localFile;
          }

          changedFiles += 1;
          nextProgress[localFile.id] = remoteFile.progress;

          return {
            ...localFile,
            status: remoteFile.status,
            bytes_uploaded: remoteFile.status === "completed" ? Number(localFile.file_size) : nextBytes,
            error_message: remoteFile.errorMessage ?? null,
            updated_at: remoteFile.updatedAt,
          };
        })
      : remote.files.map((remoteFile, index) => ({
          id: remoteFile.fileId,
          batch_id: remote.batchId,
          filename: remoteFile.filename,
          file_size: 0,
          content_type: "video/mp4",
          storage_path: "",
          public_url: remoteFile.status === "completed" ? "" : null,
          status: remoteFile.status,
          bytes_uploaded: 0,
          error_message: remoteFile.errorMessage ?? null,
          sort_order: index,
          created_at: remoteFile.updatedAt,
          updated_at: remoteFile.updatedAt,
        }));

  if (localFiles.length === 0) {
    for (const remoteFile of remote.files) {
      nextProgress[remoteFile.fileId] = remoteFile.progress;
    }
    changedFiles = remote.files.length;
  } else {
    for (const remoteFile of remote.files) {
      const localFile = localFiles.find((file) => file.id === remoteFile.fileId);
      if (!localFile || localFile.removed) continue;
      if ((nextProgress[remoteFile.fileId] ?? 0) !== remoteFile.progress) {
        nextProgress[remoteFile.fileId] = remoteFile.progress;
      }
    }
  }

  const nextBatchStatus = mapRemoteAggregateToBatchStatus(remote.status);
  const batchStatusChanged = localBatch.status !== nextBatchStatus;

  const nextBatch: UploadBatch = {
    ...localBatch,
    status: nextBatchStatus,
    total_files: remote.totalFiles,
    completed_files: remote.completed,
    failed_files: remote.failed,
    updated_at: remote.updatedAt,
    paused: remote.paused,
    upload_files: nextFiles,
  };

  return {
    batch: nextBatch,
    progressMap: nextProgress,
    changedFiles,
    batchStatusChanged,
    localStatusSummary: localStatusSummary(localBatch),
    remoteStatusSummary: remoteStatusSummary(remote),
  };
}
