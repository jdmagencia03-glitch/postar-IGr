import assert from "node:assert/strict";
import {
  batchNeedsPolling,
  computeBatchOverallPercent,
  mergeUploadProgressPercent,
  reconcileUploadBatchState,
  type UploadBatchRemoteStatus,
} from "../src/lib/upload/batch-status.ts";
import { dedupeUploadFileInputs, uploadFileIdentityKey } from "../src/lib/upload/batches.ts";
import { deriveUploadSessionView } from "../src/lib/upload/session-derived.ts";
import type { UploadBatch, UploadBatchFile } from "../src/lib/types.ts";

function makeFile(id: string, status: UploadBatchFile["status"], sortOrder: number): UploadBatchFile {
  return {
    id,
    batch_id: "batch-1",
    filename: `video-${sortOrder}.mp4`,
    file_size: 40_000_000,
    content_type: "video/mp4",
    storage_path: `path/${id}`,
    public_url: status === "completed" ? "https://example.com/v.mp4" : null,
    status,
    bytes_uploaded: status === "completed" ? 40_000_000 : 0,
    error_message: null,
    sort_order: sortOrder,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
}

function makeBatch(fileCount: number, completed = 2): UploadBatch {
  const upload_files = Array.from({ length: fileCount }, (_, index) => {
    const order = index + 1;
    const status = order <= completed ? "completed" : order <= completed + 4 ? "uploading" : "pending";
    return makeFile(`file-${order}`, status, order);
  });
  return {
    id: "batch-1",
    owner_id: "owner",
    account_id: "acc",
    schedule_mode: "auto",
    custom_schedule: null,
    status: "uploading",
    total_files: fileCount,
    completed_files: completed,
    failed_files: 0,
    batch_number: 36,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    upload_files,
  };
}

// 1) Lote grande: lista compacta e sem "reconectando" durante engineStarting
{
  const batch = makeBatch(478, 2);
  const viewRunning = deriveUploadSessionView({
    batch,
    progress: {
      completed: 2,
      failed: 0,
      uploading: 2,
      waiting: 474,
      total: 478,
      overallPercent: 0,
      bytesUploaded: 80_000_000,
      bytesTotal: 19_120_000_000,
      speedBps: 3_100_000,
      etaSeconds: 3600,
      activeFiles: [],
    },
    progressMap: {},
    running: true,
    pausedByUser: false,
    engineStarting: false,
    recoveringFromStall: false,
    canResumeWithoutPicker: true,
    needsFileReselection: false,
  });
  assert.equal(viewRunning.isActivelyUploading, true);
  assert.equal(viewRunning.statusLabel, "enviando");
  assert.ok(viewRunning.listFiles.length <= 25, `lista deve ser compacta, veio ${viewRunning.listFiles.length}`);
  assert.ok(viewRunning.listFiles.length >= 4);

  const viewStarting = deriveUploadSessionView({
    batch,
    progress: null,
    progressMap: {},
    running: false,
    pausedByUser: false,
    engineStarting: true,
    recoveringFromStall: false,
    canResumeWithoutPicker: true,
    needsFileReselection: false,
  });
  assert.equal(viewStarting.awaitingAutoRecovery, false, "não deve ficar em auto-recovery durante start");
  assert.equal(viewStarting.statusLabel, "enviando");
}

// 2) Reconcile: remote stalled não deve exigir mudança local sem progresso real
{
  const local = makeBatch(5, 1);
  const remote: UploadBatchRemoteStatus = {
    batchId: "batch-1",
    status: "active",
    totalFiles: 5,
    completed: 2,
    failed: 0,
    uploading: 2,
    retrying: 0,
    stalled: 3,
    pending: 1,
    progress: 40,
    updatedAt: "2026-01-02T00:00:00.000Z",
    paused: false,
    files: (local.upload_files ?? []).map((file, index) => ({
      fileId: file.id,
      filename: file.filename,
      status: index < 2 ? "completed" : index < 4 ? "uploading" : "pending",
      progress: index < 2 ? 100 : index < 4 ? 10 : 0,
      updatedAt: file.updated_at,
    })),
  };
  const result = reconcileUploadBatchState(local, remote, { "file-3": 5 });
  assert.ok(result.changedFiles >= 1);
  assert.equal(result.batch.completed_files, 2);
  assert.notEqual(result.batch.upload_files?.[2].status, "completed");
}

// 3) Dedupe por nome+tamanho
{
  const deduped = dedupeUploadFileInputs([
    { filename: "a.mp4", file_size: 100 },
    { filename: "a.mp4", file_size: 100 },
    { filename: "b.mp4", file_size: 100 },
  ]);
  assert.equal(deduped.length, 2);
  assert.equal(uploadFileIdentityKey({ filename: "a.mp4", file_size: 100 }), uploadFileIdentityKey({ filename: "a.mp4", file_size: 100 }));
}

// 4) Polling desliga quando lote conclui
{
  const done = makeBatch(3, 3);
  done.status = "ready";
  assert.equal(batchNeedsPolling(done), false);
  assert.equal(batchNeedsPolling(makeBatch(10, 1)), true);
}

// 5) Progresso nunca regride no reconcile
{
  assert.equal(mergeUploadProgressPercent(45, 30, "uploading", "uploading"), 45);
  assert.equal(mergeUploadProgressPercent(45, 100, "uploading", "completed"), 100);
}

// 6) Percentual geral nunca passa de 100%
{
  const percent = computeBatchOverallPercent({
    batch: {
      upload_files: [
        { id: "a", status: "completed", file_size: 100, removed: false },
        { id: "b", status: "uploading", file_size: 100, removed: false, bytes_uploaded: 50 },
      ],
    } as never,
    progress: { overallPercent: 223, bytesUploaded: 20e9, bytesTotal: 9e9 } as never,
    progressMap: { b: 50 },
    completedCount: 1,
    totalCount: 2,
  });
  assert.equal(percent <= 100, true);
}

console.log("OK — testes do fluxo de upload passaram");
