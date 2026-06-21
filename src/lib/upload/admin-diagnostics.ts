import type { SupabaseClient } from "@supabase/supabase-js";
import type { UploadBatchFile } from "@/lib/types";
import {
  expireStaleUploadLeases,
  getBatchUploadHealth,
  inspectUploadFileClaim,
  UPLOAD_FILE_LEASE_MS,
} from "@/lib/upload/queue";
import { UPLOAD_STALL_TIMEOUT_MS } from "@/lib/upload/storage-config";

export type UploadBatchDiagnostics = {
  ok: true;
  batch: {
    id: string;
    status: string;
    totalFiles: number;
    completed: number;
    uploading: number;
    failed: number;
    pending: number;
  };
  files: Array<{
    id: string;
    fileName: string;
    status: string;
    progress: number;
    updatedAt: string | null;
    lastError: string | null;
    retryCount: number;
    isStale: boolean;
    canRelease: boolean;
    mediaAssetId: string | null;
    storagePath: string | null;
    workerId: string | null;
    leaseUntil: string | null;
  }>;
  recommendedAction: "wait" | "resume" | "release_stalled_file" | "already_completed";
};

function fileProgress(file: UploadBatchFile) {
  const total = Number(file.file_size) || 0;
  if (file.status === "completed") return 100;
  return total > 0 ? Math.round((Number(file.bytes_uploaded ?? 0) / total) * 100) : 0;
}

function isFileStale(file: UploadBatchFile, now = Date.now()) {
  if (file.status !== "uploading" && file.status !== "retrying") return false;
  const ref = file.last_progress_at ?? file.updated_at;
  if (!ref) return true;
  return now - new Date(ref).getTime() >= UPLOAD_STALL_TIMEOUT_MS;
}

function canReleaseFile(file: UploadBatchFile, now = Date.now()) {
  if (file.status === "completed") return false;
  if (file.public_url) return false;
  const leaseExpired =
    !file.lease_until || new Date(file.lease_until).getTime() <= now;
  const stale = isFileStale(file, now);
  return (
    (file.status === "uploading" || file.status === "retrying" || file.status === "stalled") &&
    (leaseExpired || stale)
  );
}

export async function buildUploadBatchDiagnostics(
  supabase: SupabaseClient,
  ownerId: string,
  batchId: string,
  fileId?: string,
): Promise<UploadBatchDiagnostics | { ok: false; error: string }> {
  const health = await getBatchUploadHealth(supabase, ownerId, batchId);
  if (!health) return { ok: false, error: "batch_not_found" };

  const { data: files, error } = await supabase
    .from("upload_files")
    .select("*")
    .eq("batch_id", batchId)
    .order("sort_order", { ascending: true });

  if (error) return { ok: false, error: error.message };

  const now = Date.now();
  const active = ((files ?? []) as UploadBatchFile[]).filter((f) => !f.removed);
  const filtered = fileId ? active.filter((f) => f.id === fileId) : active;

  const fileRows = filtered.map((file) => ({
    id: file.id,
    fileName: file.filename,
    status: file.status,
    progress: fileProgress(file),
    updatedAt: file.updated_at ?? null,
    lastError: file.error_message ?? null,
    retryCount: file.retry_count ?? 0,
    isStale: isFileStale(file, now),
    canRelease: canReleaseFile(file, now),
    mediaAssetId: (file as UploadBatchFile & { media_asset_id?: string }).media_asset_id ?? null,
    storagePath: file.storage_path ?? null,
    workerId: file.worker_id ?? null,
    leaseUntil: file.lease_until ?? null,
  }));

  let recommendedAction: UploadBatchDiagnostics["recommendedAction"] = "wait";
  if (health.completed === health.total && health.total > 0) {
    recommendedAction = "already_completed";
  } else if (fileRows.some((f) => f.canRelease)) {
    recommendedAction = "release_stalled_file";
  } else if (health.pending > 0 || health.uploading > 0) {
    recommendedAction = health.isStalled ? "release_stalled_file" : "resume";
  }

  return {
    ok: true,
    batch: {
      id: batchId,
      status: health.status,
      totalFiles: health.total,
      completed: health.completed,
      uploading: health.uploading + health.retrying,
      failed: health.failed,
      pending: health.pending,
    },
    files: fileRows,
    recommendedAction,
  };
}

export type ReleaseStalledUploadFileResult = {
  ok: true;
  released: boolean;
  dryRun: boolean;
  fileId: string;
  previousStatus: string;
  newStatus: string;
  nextStep: string;
  reasons: string[];
};

export async function releaseStalledUploadFile(
  supabase: SupabaseClient,
  ownerId: string,
  params: { batchId: string; fileId: string; confirm: boolean },
): Promise<ReleaseStalledUploadFileResult | { ok: false; error: string; reasons?: string[] }> {
  const { data: batch } = await supabase
    .from("upload_batches")
    .select("id")
    .eq("id", params.batchId)
    .eq("owner_id", ownerId)
    .maybeSingle();

  if (!batch) return { ok: false, error: "batch_not_found" };

  const { data: fileRow } = await supabase
    .from("upload_files")
    .select("*")
    .eq("id", params.fileId)
    .eq("batch_id", params.batchId)
    .maybeSingle();

  if (!fileRow) return { ok: false, error: "file_not_found" };

  const file = fileRow as UploadBatchFile;
  const reasons: string[] = [];

  if (file.removed) reasons.push("file_removed");
  if (file.status === "completed") reasons.push("already_completed");
  if (file.public_url) reasons.push("media_already_has_public_url");

  const releasableStatuses = ["uploading", "retrying", "stalled", "pending"];
  if (!releasableStatuses.includes(file.status)) {
    reasons.push(`status_not_releasable:${file.status}`);
  }

  const now = Date.now();
  const leaseActive =
    Boolean(file.worker_id) &&
    Boolean(file.lease_until) &&
    new Date(file.lease_until as string).getTime() > now;

  if (leaseActive && !isFileStale(file, now)) {
    reasons.push("active_lease_not_stale");
  }

  if (reasons.length) {
    return { ok: false, error: "cannot_release", reasons };
  }

  if (!params.confirm) {
    return {
      ok: true,
      released: false,
      dryRun: true,
      fileId: params.fileId,
      previousStatus: file.status,
      newStatus: "pending",
      nextStep: "retry_upload",
      reasons: [],
    };
  }

  const { error: updateError } = await supabase
    .from("upload_files")
    .update({
      status: "pending",
      worker_id: null,
      lease_until: null,
      error_message: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", params.fileId)
    .eq("batch_id", params.batchId);

  if (updateError) return { ok: false, error: updateError.message };

  await expireStaleUploadLeases(supabase, params.batchId);

  return {
    ok: true,
    released: true,
    dryRun: false,
    fileId: params.fileId,
    previousStatus: file.status,
    newStatus: "pending",
    nextStep: "retry_upload",
    reasons: [],
  };
}

export { UPLOAD_FILE_LEASE_MS, inspectUploadFileClaim };
