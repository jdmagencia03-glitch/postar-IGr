import type { SupabaseClient } from "@supabase/supabase-js";
import { DB_INSERT_CHUNK_SIZE, UPLOAD_STALL_TIMEOUT_MS } from "@/lib/upload/storage-config";
import type { SocialPlatform, UploadBatch, UploadBatchFile, UploadBatchStatus, UploadFileStatus } from "@/lib/types";
import type { UploadBatchRemoteStatus } from "@/lib/upload/batch-status";

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

/** Lote que impede criar outro — só enquanto ainda está enviando. */
export function isBlockingBatchStatus(status: UploadBatchStatus) {
  return status === "uploading";
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

export async function getUploadingBatchForOwner(
  supabase: SupabaseClient,
  ownerId: string,
  accountScope?: { platform: SocialPlatform; accountId: string },
) {
  let query = supabase
    .from("upload_batches")
    .select("id")
    .eq("owner_id", ownerId)
    .eq("status", "uploading");

  if (accountScope) {
    query = query.eq("platform", accountScope.platform);
    if (accountScope.platform === "tiktok") {
      query = query.eq("tiktok_account_id", accountScope.accountId);
    } else {
      query = query.eq("account_id", accountScope.accountId);
    }
  }

  const { data } = await query.order("created_at", { ascending: false }).limit(1).maybeSingle();

  if (!data) return null;
  return getBatchForOwner(supabase, ownerId, data.id);
}

export async function getActiveBatchSummaryForOwner(
  supabase: SupabaseClient,
  ownerId: string,
  accountScope?: { platform: SocialPlatform; accountId: string },
) {
  let query = supabase
    .from("upload_batches")
    .select("*, instagram_accounts(ig_username), tiktok_accounts(username, display_name)")
    .eq("owner_id", ownerId)
    .in("status", ["uploading", "ready"]);

  if (accountScope) {
    query = query.eq("platform", accountScope.platform);
    if (accountScope.platform === "tiktok") {
      query = query.eq("tiktok_account_id", accountScope.accountId);
    } else {
      query = query.eq("account_id", accountScope.accountId);
    }
  }

  const { data } = await query.order("created_at", { ascending: false }).limit(1).maybeSingle();

  if (!data) return null;

  return { ...(data as UploadBatch), upload_files: [] as UploadBatchFile[] };
}

export async function getActiveBatchForOwner(
  supabase: SupabaseClient,
  ownerId: string,
  accountScope?: { platform: SocialPlatform; accountId: string },
) {
  const summary = await getActiveBatchSummaryForOwner(supabase, ownerId, accountScope);
  if (!summary) return null;

  await resetStaleUploadingFiles(supabase, summary.id);
  const upload_files = await getBatchUploadFiles(supabase, summary.id);
  return { ...summary, upload_files };
}

export async function countAccountUploadedVideos(
  supabase: SupabaseClient,
  ownerId: string,
  platform: SocialPlatform,
  accountId: string,
) {
  let batchQuery = supabase
    .from("upload_batches")
    .select("id")
    .eq("owner_id", ownerId)
    .eq("platform", platform)
    .in("status", ["uploading", "ready", "scheduling"]);

  batchQuery =
    platform === "tiktok"
      ? batchQuery.eq("tiktok_account_id", accountId)
      : batchQuery.eq("account_id", accountId);

  const { data: batches, error } = await batchQuery;
  if (error) throw new Error(error.message);
  if (!batches?.length) return { batches: 0, files: 0 };

  const batchIds = batches.map((batch) => batch.id);
  const { count, error: filesError } = await supabase
    .from("upload_files")
    .select("id", { count: "exact", head: true })
    .in("batch_id", batchIds)
    .eq("status", "completed")
    .or("removed.is.null,removed.eq.false");

  if (filesError) throw new Error(filesError.message);

  return { batches: batches.length, files: count ?? 0 };
}

export async function clearAccountUploadedVideos(
  supabase: SupabaseClient,
  ownerId: string,
  platform: SocialPlatform,
  accountId: string,
) {
  let batchQuery = supabase
    .from("upload_batches")
    .select("id")
    .eq("owner_id", ownerId)
    .eq("platform", platform)
    .in("status", ["uploading", "ready", "scheduling"]);

  batchQuery =
    platform === "tiktok"
      ? batchQuery.eq("tiktok_account_id", accountId)
      : batchQuery.eq("account_id", accountId);

  const { data: batches, error } = await batchQuery;
  if (error) throw new Error(error.message);
  if (!batches?.length) {
    return { batchesCleared: 0, filesCleared: 0, storagePathsRemoved: 0 };
  }

  const batchIds = batches.map((batch) => batch.id);
  const files = await getBatchUploadFilesForIds(supabase, batchIds);
  const activeFiles = files.filter((file) => !file.removed);
  const storagePaths = [
    ...new Set(activeFiles.map((file) => file.storage_path).filter(Boolean)),
  ];

  if (storagePaths.length) {
    for (let offset = 0; offset < storagePaths.length; offset += 100) {
      const chunk = storagePaths.slice(offset, offset + 100);
      const { error: storageError } = await supabase.storage.from("media").remove(chunk);
      if (storageError) {
        console.warn("[upload-clear] storage_remove_error", {
          platform,
          accountId,
          error: storageError.message,
        });
      }
    }
  }

  const now = new Date().toISOString();
  if (activeFiles.length) {
    const { error: filesError } = await supabase
      .from("upload_files")
      .update({
        removed: true,
        public_url: null,
        updated_at: now,
      })
      .in(
        "id",
        activeFiles.map((file) => file.id),
      );

    if (filesError) throw new Error(filesError.message);
  }

  const { error: batchError } = await supabase
    .from("upload_batches")
    .update({
      status: "cancelled",
      updated_at: now,
    })
    .in("id", batchIds);

  if (batchError) throw new Error(batchError.message);

  console.info("[upload-clear] account_videos_cleared", {
    ownerId,
    platform,
    accountId,
    batchesCleared: batchIds.length,
    filesCleared: activeFiles.length,
    storagePathsRemoved: storagePaths.length,
  });

  return {
    batchesCleared: batchIds.length,
    filesCleared: activeFiles.length,
    storagePathsRemoved: storagePaths.length,
  };
}

export async function countAccountUploadBatches(
  supabase: SupabaseClient,
  ownerId: string,
  platform: SocialPlatform,
  accountId: string,
) {
  let batchQuery = supabase
    .from("upload_batches")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", ownerId)
    .eq("platform", platform);

  batchQuery =
    platform === "tiktok"
      ? batchQuery.eq("tiktok_account_id", accountId)
      : batchQuery.eq("account_id", accountId);

  const { count, error } = await batchQuery;
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export async function deleteAccountUploadBatches(
  supabase: SupabaseClient,
  ownerId: string,
  platform: SocialPlatform,
  accountId: string,
) {
  let batchQuery = supabase
    .from("upload_batches")
    .select("id")
    .eq("owner_id", ownerId)
    .eq("platform", platform);

  batchQuery =
    platform === "tiktok"
      ? batchQuery.eq("tiktok_account_id", accountId)
      : batchQuery.eq("account_id", accountId);

  const { data: batches, error } = await batchQuery;
  if (error) throw new Error(error.message);
  if (!batches?.length) {
    return { batchesDeleted: 0, filesDeleted: 0, storagePathsRemoved: 0 };
  }

  const batchIds = batches.map((batch) => batch.id);
  const files = await getBatchUploadFilesForIds(supabase, batchIds);
  const storagePaths = [
    ...new Set(files.map((file) => file.storage_path).filter(Boolean)),
  ];

  if (storagePaths.length) {
    for (let offset = 0; offset < storagePaths.length; offset += 100) {
      const chunk = storagePaths.slice(offset, offset + 100);
      const { error: storageError } = await supabase.storage.from("media").remove(chunk);
      if (storageError) {
        console.warn("[upload-clear] batch_storage_remove_error", {
          platform,
          accountId,
          error: storageError.message,
        });
      }
    }
  }

  const { error: deleteError } = await supabase.from("upload_batches").delete().in("id", batchIds);
  if (deleteError) throw new Error(deleteError.message);

  console.info("[upload-clear] account_batches_deleted", {
    ownerId,
    platform,
    accountId,
    batchesDeleted: batchIds.length,
    filesDeleted: files.length,
    storagePathsRemoved: storagePaths.length,
  });

  return {
    batchesDeleted: batchIds.length,
    filesDeleted: files.length,
    storagePathsRemoved: storagePaths.length,
  };
}

/** Remove um lote do histórico (hard delete) — storage + registro no banco. */
export async function deleteUploadBatchForOwner(
  supabase: SupabaseClient,
  ownerId: string,
  batchId: string,
) {
  const batch = await getBatchForOwner(supabase, ownerId, batchId);
  if (!batch) return null;

  if (batch.status === "uploading") {
    throw new Error("Aguarde o upload terminar ou pause antes de apagar este lote.");
  }

  const files = await getBatchUploadFiles(supabase, batchId);
  const storagePaths = [
    ...new Set(files.map((file) => file.storage_path).filter(Boolean)),
  ];

  if (storagePaths.length) {
    for (let offset = 0; offset < storagePaths.length; offset += 100) {
      const chunk = storagePaths.slice(offset, offset + 100);
      const { error: storageError } = await supabase.storage.from("media").remove(chunk);
      if (storageError) {
        console.warn("[upload-clear] batch_storage_remove_error", {
          batchId,
          error: storageError.message,
        });
      }
    }
  }

  const { error: deleteError } = await supabase
    .from("upload_batches")
    .delete()
    .eq("id", batchId)
    .eq("owner_id", ownerId);

  if (deleteError) throw new Error(deleteError.message);

  console.info("[upload-clear] batch_deleted", {
    ownerId,
    batchId,
    filesDeleted: files.length,
    storagePathsRemoved: storagePaths.length,
  });

  return {
    batchId,
    filesDeleted: files.length,
    storagePathsRemoved: storagePaths.length,
  };
}

async function getBatchUploadFilesForIds(supabase: SupabaseClient, batchIds: string[]) {
  if (!batchIds.length) return [] as UploadBatchFile[];

  const files: UploadBatchFile[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase
      .from("upload_files")
      .select("*")
      .in("batch_id", batchIds)
      .order("sort_order", { ascending: true })
      .range(offset, offset + 999);

    if (error) throw new Error(error.message);
    if (!data?.length) break;

    files.push(...(data as UploadBatchFile[]));
    if (data.length < 1000) break;
  }

  return files;
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

  await resetStaleUploadingFiles(supabase, batchId);
  const upload_files = await getBatchUploadFiles(supabase, batchId);
  return { ...(data as UploadBatch), upload_files };
}

export async function verifyBatchFileAccess(
  supabase: SupabaseClient,
  ownerId: string,
  batchId: string,
  fileId: string,
) {
  const { data: batch } = await supabase
    .from("upload_batches")
    .select("id, status, owner_id")
    .eq("id", batchId)
    .eq("owner_id", ownerId)
    .maybeSingle();

  if (!batch) return null;

  const { data: file } = await supabase
    .from("upload_files")
    .select("id, status, batch_id")
    .eq("id", fileId)
    .eq("batch_id", batchId)
    .maybeSingle();

  if (!file) return null;

  return { batch, file };
}

export interface BatchCounters {
  total: number;
  completed: number;
  failed: number;
  status: UploadBatchStatus;
}

/** Arquivos órfãos em "uploading" após crash/refresh — voltam para pending. */
const STALE_UPLOADING_MS = 15 * 60_000;

export async function resetStaleUploadingFiles(
  supabase: SupabaseClient,
  batchId: string,
): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_UPLOADING_MS).toISOString();

  const { data: stale, error: selectError } = await supabase
    .from("upload_files")
    .select("id")
    .eq("batch_id", batchId)
    .eq("status", "uploading")
    .or("removed.is.null,removed.eq.false")
    .lt("updated_at", cutoff);

  if (selectError) throw new Error(selectError.message);
  if (!stale?.length) return 0;

  const { error: updateError } = await supabase
    .from("upload_files")
    .update({
      status: "pending",
      updated_at: new Date().toISOString(),
    })
    .eq("batch_id", batchId)
    .eq("status", "uploading")
    .lt("updated_at", cutoff);

  if (updateError) throw new Error(updateError.message);

  await refreshBatchCounters(supabase, batchId);
  return stale.length;
}

export async function getBatchFileStatusCounts(
  supabase: SupabaseClient,
  batchId: string,
) {
  const notRemoved = "removed.is.null,removed.eq.false";
  const statuses = ["completed", "pending", "uploading", "failed"] as const;
  const counts: Record<(typeof statuses)[number], number> = {
    completed: 0,
    pending: 0,
    uploading: 0,
    failed: 0,
  };

  await Promise.all(
    statuses.map(async (status) => {
      const { count } = await supabase
        .from("upload_files")
        .select("id", { count: "exact", head: true })
        .eq("batch_id", batchId)
        .or(notRemoved)
        .eq("status", status);
      counts[status] = count ?? 0;
    }),
  );

  return counts;
}

export async function getBatchStatusLight(
  supabase: SupabaseClient,
  ownerId: string,
  batchId: string,
): Promise<UploadBatchRemoteStatus | null> {
  const { data: batchRow, error: batchError } = await supabase
    .from("upload_batches")
    .select("id, status, total_files, completed_files, failed_files, updated_at, paused")
    .eq("id", batchId)
    .eq("owner_id", ownerId)
    .maybeSingle();

  if (batchError) throw new Error(batchError.message);
  if (!batchRow) return null;

  const { data: files, error: filesError } = await supabase
    .from("upload_files")
    .select("id, filename, status, bytes_uploaded, file_size, error_message, updated_at, removed")
    .eq("batch_id", batchId)
    .order("sort_order", { ascending: true });

  if (filesError) throw new Error(filesError.message);

  const activeFiles = (files ?? []).filter((file) => !file.removed);
  const now = Date.now();

  let completed = 0;
  let failed = 0;
  let uploading = 0;
  let retrying = 0;
  let pending = 0;
  let stalled = 0;

  const fileStatuses = activeFiles.map((file) => {
    const total = Number(file.file_size) || 0;
    const uploaded = Number(file.bytes_uploaded ?? 0);
    const progress =
      file.status === "completed" ? 100 : total > 0 ? Math.round((uploaded / total) * 100) : 0;

    switch (file.status) {
      case "completed":
        completed += 1;
        break;
      case "failed":
        failed += 1;
        break;
      case "uploading":
        uploading += 1;
        break;
      case "retrying":
        retrying += 1;
        break;
      default:
        pending += 1;
        break;
    }

    const isStalled =
      (file.status === "uploading" || file.status === "retrying") &&
      now - new Date(file.updated_at).getTime() >= UPLOAD_STALL_TIMEOUT_MS;
    if (isStalled) stalled += 1;

    return {
      fileId: file.id,
      filename: file.filename,
      status: file.status as UploadFileStatus,
      progress,
      errorMessage: file.error_message,
      updatedAt: file.updated_at,
    };
  });

  const totalFiles = activeFiles.length;
  const progressPercent = totalFiles ? Math.round((completed / totalFiles) * 100) : 0;

  let aggregateStatus: UploadBatchRemoteStatus["status"] = "active";
  if (batchRow.status === "cancelled") {
    aggregateStatus = "cancelled";
  } else if (batchRow.status === "ready" || (completed + failed === totalFiles && totalFiles > 0)) {
    if (failed === 0) aggregateStatus = "completed";
    else if (completed === 0) aggregateStatus = "failed";
    else aggregateStatus = "partial_failed";
  }

  return {
    batchId: batchRow.id,
    status: aggregateStatus,
    totalFiles,
    completed,
    failed,
    uploading,
    retrying,
    stalled,
    pending,
    progress: progressPercent,
    updatedAt: batchRow.updated_at,
    paused: Boolean(batchRow.paused),
    files: fileStatuses,
  };
}

export async function refreshBatchCounters(
  supabase: SupabaseClient,
  batchId: string,
): Promise<BatchCounters> {
  const notRemoved = "removed.is.null,removed.eq.false";

  const [batchResult, completedResult, failedResult, totalResult, pendingResult] =
    await Promise.all([
      supabase.from("upload_batches").select("status").eq("id", batchId).single(),
      supabase
        .from("upload_files")
        .select("id", { count: "exact", head: true })
        .eq("batch_id", batchId)
        .or(notRemoved)
        .eq("status", "completed"),
      supabase
        .from("upload_files")
        .select("id", { count: "exact", head: true })
        .eq("batch_id", batchId)
        .or(notRemoved)
        .eq("status", "failed"),
      supabase
        .from("upload_files")
        .select("id", { count: "exact", head: true })
        .eq("batch_id", batchId)
        .or(notRemoved),
      supabase
        .from("upload_files")
        .select("id", { count: "exact", head: true })
        .eq("batch_id", batchId)
        .or(notRemoved)
        .in("status", ["pending", "uploading", "retrying"]),
    ]);

  const batchRow = batchResult.data;
  const completed = completedResult.count ?? 0;
  const failed = failedResult.count ?? 0;
  const total = totalResult.count ?? 0;
  const allDone = completed + failed === total && total > 0;
  const hasPending = (pendingResult.count ?? 0) > 0;

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
    refreshCounters?: boolean;
  },
) {
  const { data: file, error } = await supabase
    .from("upload_files")
    .update({
      status: params.status,
      public_url: params.publicUrl ?? null,
      bytes_uploaded: params.bytesUploaded ?? 0,
      error_message: params.errorMessage ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", params.fileId)
    .eq("batch_id", params.batchId)
    .select("*")
    .single();

  if (error) throw new Error(error.message);

  const counters =
    params.refreshCounters === false
      ? undefined
      : await refreshBatchCounters(supabase, params.batchId);

  return { file: file as UploadBatchFile, counters };
}

export async function listBatchHistoryForOwner(
  supabase: SupabaseClient,
  ownerId: string,
  limit = 30,
) {
  const { data, error } = await supabase
    .from("upload_batches")
    .select("*, instagram_accounts(ig_username), tiktok_accounts(username, display_name)")
    .eq("owner_id", ownerId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(error.message);
  return (data ?? []) as UploadBatch[];
}

export function buildStoragePath(ownerId: string, batchId: string, fileId: string, filename: string) {
  const ext = filename.split(".").pop()?.toLowerCase() || "mp4";
  return `${ownerId}/${batchId}/${fileId}.${ext}`;
}
