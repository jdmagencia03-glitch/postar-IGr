import type { SupabaseClient } from "@supabase/supabase-js";
import { DB_INSERT_CHUNK_SIZE } from "@/lib/upload/storage-config";
import type { UploadBatch, UploadBatchFile, UploadBatchStatus, UploadFileStatus } from "@/lib/types";

export interface UploadFileInput {
  filename: string;
  file_size: number;
  content_type?: string;
  file_hash?: string;
  last_modified?: number;
}

export function buildUploadFileRows(
  ownerId: string,
  batchId: string,
  files: UploadFileInput[],
  sortOrderOffset = 0,
) {
  return files.map((file, index) => {
    const fileId = crypto.randomUUID();
    return {
      id: fileId,
      batch_id: batchId,
      filename: file.filename,
      file_size: file.file_size,
      content_type: file.content_type || "video/mp4",
      storage_path: buildStoragePath(ownerId, batchId, fileId, file.filename),
      file_hash: file.file_hash ?? null,
      last_modified: file.last_modified ?? null,
      sort_order: sortOrderOffset + index,
      status: "pending" as const,
    };
  });
}

export async function insertUploadFiles(
  supabase: SupabaseClient,
  rows: ReturnType<typeof buildUploadFileRows>,
) {
  const inserted: UploadBatchFile[] = [];

  for (let offset = 0; offset < rows.length; offset += DB_INSERT_CHUNK_SIZE) {
    const chunk = rows.slice(offset, offset + DB_INSERT_CHUNK_SIZE);
    const { data, error } = await supabase.from("upload_files").insert(chunk).select("*");

    if (error) {
      throw new Error(error.message);
    }

    inserted.push(...((data ?? []) as UploadBatchFile[]));
  }

  return inserted;
}

export function isActiveBatchStatus(status: UploadBatchStatus) {
  return status === "uploading" || status === "ready";
}

export async function getBatchUploadFiles(supabase: SupabaseClient, batchId: string) {
  const pageSize = 1000;
  const files: UploadBatchFile[] = [];

  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase
      .from("upload_files")
      .select("*")
      .eq("batch_id", batchId)
      .order("sort_order", { ascending: true })
      .range(offset, offset + pageSize - 1);

    if (error) throw new Error(error.message);
    if (!data?.length) break;

    files.push(...(data as UploadBatchFile[]));
    if (data.length < pageSize) break;
  }

  return files;
}

export async function getActiveBatchForOwner(supabase: SupabaseClient, ownerId: string) {
  const { data } = await supabase
    .from("upload_batches")
    .select("*, instagram_accounts(ig_username)")
    .eq("owner_id", ownerId)
    .in("status", ["uploading", "ready"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return null;

  const upload_files = await getBatchUploadFiles(supabase, data.id);
  return { ...(data as UploadBatch), upload_files };
}

export async function getBatchForOwner(
  supabase: SupabaseClient,
  ownerId: string,
  batchId: string,
) {
  const { data } = await supabase
    .from("upload_batches")
    .select("*, instagram_accounts(ig_username)")
    .eq("owner_id", ownerId)
    .eq("id", batchId)
    .maybeSingle();

  if (!data) return null;

  const upload_files = await getBatchUploadFiles(supabase, batchId);
  return { ...(data as UploadBatch), upload_files };
}

export async function refreshBatchCounters(supabase: SupabaseClient, batchId: string) {
  const [{ data: batchRow }, { data: files }] = await Promise.all([
    supabase.from("upload_batches").select("status").eq("id", batchId).single(),
    supabase.from("upload_files").select("status").eq("batch_id", batchId),
  ]);

  const rows = files ?? [];
  const completed = rows.filter((file) => file.status === "completed").length;
  const failed = rows.filter((file) => file.status === "failed").length;
  const total = rows.length;
  const allDone = completed + failed === total && total > 0;
  const hasPending = rows.some((file) => file.status === "pending" || file.status === "uploading");

  let status: UploadBatchStatus = "uploading";
  if (!hasPending && allDone && completed > 0) status = "ready";
  if (!hasPending && allDone && completed === 0) status = "uploading";

  const currentStatus = batchRow?.status as UploadBatchStatus | undefined;
  const preserveStatus =
    currentStatus === "cancelled" || currentStatus === "scheduled" || currentStatus === "scheduling";
  const nextStatus = preserveStatus ? currentStatus! : status;

  await supabase
    .from("upload_batches")
    .update({
      total_files: total,
      completed_files: completed,
      failed_files: failed,
      status: nextStatus,
      finished_at: nextStatus === "ready" ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", batchId);

  return { total, completed, failed, status: nextStatus };
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
