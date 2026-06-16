import type { SupabaseClient } from "@supabase/supabase-js";
import type { UploadBatch, UploadBatchFile, UploadBatchStatus, UploadFileStatus } from "@/lib/types";

export function isActiveBatchStatus(status: UploadBatchStatus) {
  return status === "uploading" || status === "ready";
}

export async function getActiveBatchForOwner(supabase: SupabaseClient, ownerId: string) {
  const { data } = await supabase
    .from("upload_batches")
    .select("*, upload_files(*), instagram_accounts(ig_username)")
    .eq("owner_id", ownerId)
    .in("status", ["uploading", "ready"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return data as (UploadBatch & { upload_files: UploadBatchFile[] }) | null;
}

export async function getBatchForOwner(
  supabase: SupabaseClient,
  ownerId: string,
  batchId: string,
) {
  const { data } = await supabase
    .from("upload_batches")
    .select("*, upload_files(*), instagram_accounts(ig_username)")
    .eq("owner_id", ownerId)
    .eq("id", batchId)
    .maybeSingle();

  return data as (UploadBatch & { upload_files: UploadBatchFile[] }) | null;
}

export async function refreshBatchCounters(supabase: SupabaseClient, batchId: string) {
  const { data: files } = await supabase
    .from("upload_files")
    .select("status")
    .eq("batch_id", batchId);

  const rows = files ?? [];
  const completed = rows.filter((file) => file.status === "completed").length;
  const failed = rows.filter((file) => file.status === "failed").length;
  const total = rows.length;
  const allDone = completed + failed === total && total > 0;
  const hasPending = rows.some((file) => file.status === "pending" || file.status === "uploading");

  let status: UploadBatchStatus = "uploading";
  if (!hasPending && allDone && completed > 0) status = "ready";
  if (!hasPending && allDone && completed === 0) status = "uploading";

  await supabase
    .from("upload_batches")
    .update({
      total_files: total,
      completed_files: completed,
      failed_files: failed,
      status,
      finished_at: status === "ready" ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", batchId);

  return { total, completed, failed, status };
}

export async function updateUploadFileStatus(
  supabase: SupabaseClient,
  params: {
    batchId: string;
    fileId: string;
    status: UploadFileStatus;
    publicUrl?: string | null;
    bytesUploaded?: number;
    errorMessage?: string | null;
  },
) {
  const { error } = await supabase
    .from("upload_files")
    .update({
      status: params.status,
      public_url: params.publicUrl ?? null,
      bytes_uploaded: params.bytesUploaded ?? 0,
      error_message: params.errorMessage ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", params.fileId)
    .eq("batch_id", params.batchId);

  if (error) throw new Error(error.message);

  return refreshBatchCounters(supabase, params.batchId);
}

export function buildStoragePath(ownerId: string, batchId: string, fileId: string, filename: string) {
  const ext = filename.split(".").pop()?.toLowerCase() || "mp4";
  return `${ownerId}/${batchId}/${fileId}.${ext}`;
}
