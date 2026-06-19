import type { UploadBatch, UploadBatchFile, UploadBatchStatus, UploadSpeedMode } from "@/lib/types";
import { BATCH_CREATE_CHUNK_SIZE, TUS_CHUNK_SIZE, UPLOAD_PROGRESS_DB_SYNC_BYTES } from "@/lib/upload/storage-config";
import { extractUploadErrorMessage, humanizeFetchError } from "@/lib/upload/errors";
import { uploadFileWithTus, type TusPrepareResponse } from "@/lib/upload/tus-upload";
import type { BatchCounters } from "@/lib/upload/batches";

const RETRY_DELAYS = [0, 3000, 10000, 30000, 60000, 90000];

export interface UploadFilePatchResult {
  file: UploadBatchFile;
  counters: BatchCounters | null;
}

export function applyBatchFilePatch(batch: UploadBatch, patch: UploadFilePatchResult): UploadBatch {
  const counters = patch.counters;
  const completed = counters?.completed ?? batch.completed_files;
  const failed = counters?.failed ?? batch.failed_files;
  return {
    ...batch,
    total_files: counters?.total ?? batch.total_files,
    completed_files: Math.max(batch.completed_files, completed),
    failed_files: Math.max(batch.failed_files, failed),
    status: counters?.status ?? batch.status,
    upload_files: (batch.upload_files ?? []).map((item) =>
      item.id === patch.file.id ? { ...item, ...patch.file } : item,
    ),
  };
}

function appendFilesToBatch(
  batch: UploadBatch,
  added: UploadBatchFile[],
  counters?: BatchCounters,
): UploadBatch {
  return {
    ...batch,
    total_files: counters?.total ?? batch.total_files + added.length,
    completed_files: counters?.completed ?? batch.completed_files,
    failed_files: counters?.failed ?? batch.failed_files,
    status: counters?.status ?? batch.status,
    upload_files: [...(batch.upload_files ?? []), ...added],
  };
}

function chunkItems<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function serializeUploadFiles(files: Array<{ file: File; fingerprint: string }>) {
  return files.map(({ file, fingerprint }) => ({
    filename: file.name,
    file_size: file.size,
    content_type: file.type || "video/mp4",
    file_hash: fingerprint,
    last_modified: file.lastModified,
  }));
}

async function apiFetch(input: RequestInfo | URL, init?: RequestInit, attempt = 0): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(input, {
      ...init,
      credentials: "include",
    });
  } catch (error) {
    throw new Error(humanizeFetchError(error));
  }

  if (response.status === 429 && attempt < 4) {
    const retryAfter = Number(response.headers.get("Retry-After") || "2");
    await new Promise((resolve) => setTimeout(resolve, Math.max(retryAfter, 1) * 1000));
    return apiFetch(input, init, attempt + 1);
  }

  if (response.status === 401) {
    const next =
      typeof window !== "undefined"
        ? `${window.location.pathname}${window.location.search}`
        : "/dashboard/bulk";
    window.location.href = `/login?next=${encodeURIComponent(next)}`;
    throw new Error("Sessão expirada. Faça login novamente.");
  }

  return response;
}

export function fileFingerprint(file: File) {
  return `${file.name}|${file.size}|${file.lastModified}`;
}

export function matchFileToRecord(file: File, records: UploadBatchFile[]) {
  const fingerprint = fileFingerprint(file);
  const byHash = records.find((record) => record.file_hash === fingerprint);
  if (byHash) return byHash;

  const byMeta = records.filter(
    (record) =>
      record.filename === file.name &&
      Number(record.file_size) === file.size &&
      (record.last_modified == null || record.last_modified === file.lastModified),
  );
  if (byMeta.length === 1) return byMeta[0];
  return undefined;
}

export function findRecordForUpload(
  file: File,
  fingerprint: string,
  records: UploadBatchFile[],
): UploadBatchFile | undefined {
  const byHash = records.find((record) => record.file_hash === fingerprint);
  if (byHash) return byHash;
  return matchFileToRecord(file, records);
}

export async function uploadBatchFile(params: {
  batch: UploadBatch;
  record: UploadBatchFile;
  file: File;
  signal?: AbortSignal;
  onProgress?: (bytesUploaded: number, bytesTotal: number) => void;
}): Promise<UploadFilePatchResult> {
  const { batch, file, onProgress, signal } = params;
  let record = params.record;

  for (let attempt = 0; attempt < RETRY_DELAYS.length; attempt++) {
    if (signal?.aborted) {
      throw new DOMException("Upload pausado", "AbortError");
    }

    if (attempt > 0) {
      console.info("[upload-retry] retry_attempt", {
        batchId: batch.id,
        fileId: record.id,
        filename: file.name,
        attempt: attempt + 1,
        maxAttempts: RETRY_DELAYS.length,
      });
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS[attempt]));
    }

    try {
      console.info("[upload-worker] upload_start", {
        batchId: batch.id,
        fileId: record.id,
        filename: file.name,
        attempt: attempt + 1,
        previousStatus: record.status,
      });
      const prepareRes = await apiFetch("/api/upload/files/prepare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          batch_id: batch.id,
          file_id: record.id,
          storage_path: record.storage_path,
          name: file.name,
          type: file.type,
          size: file.size,
        }),
      });

      const prepareData = (await prepareRes.json()) as TusPrepareResponse & {
        error?: unknown;
      };
      if (!prepareRes.ok) {
        throw new Error(String(prepareData.error ?? "Falha ao preparar upload"));
      }

      if (!prepareData.tusEndpoint || !prepareData.signature) {
        throw new Error("Resposta de upload inválida (TUS não configurado)");
      }

      const uploadedBytes = Number(record.bytes_uploaded ?? 0);
      const partialLooksBroken =
        file.size > TUS_CHUNK_SIZE &&
        uploadedBytes > 0 &&
        uploadedBytes <= TUS_CHUNK_SIZE;

      let shouldResume =
        record.status !== "failed" &&
        uploadedBytes > 0 &&
        !partialLooksBroken;

      if (record.status === "failed" || partialLooksBroken) {
        record = { ...record, status: "pending", bytes_uploaded: 0, error_message: null };
        shouldResume = false;
        await apiFetch(`/api/upload/batches/${batch.id}/files/${record.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            status: "pending",
            bytes_uploaded: 0,
            error_message: null,
          }),
        }).catch(() => undefined);
      }

      let lastDbSync = 0;
      const { promise } = uploadFileWithTus({
        file,
        prepare: prepareData,
        batchId: batch.id,
        recordId: record.id,
        signal,
        resumePrevious: shouldResume && attempt === 0,
        onProgress: (loaded, total) => {
          onProgress?.(loaded, total);
          if (loaded - lastDbSync >= UPLOAD_PROGRESS_DB_SYNC_BYTES || loaded === total) {
            lastDbSync = loaded;
            void apiFetch(`/api/upload/batches/${batch.id}/files/${record.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ status: "uploading", bytes_uploaded: loaded }),
            }).catch(() => undefined);
          }
        },
      });

      await promise;

      const patchRes = await apiFetch(`/api/upload/batches/${batch.id}/files/${record.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "completed",
          public_url: prepareData.publicUrl,
          bytes_uploaded: file.size,
          error_message: null,
        }),
      });

      const patchData = (await patchRes.json()) as UploadFilePatchResult & { error?: unknown };
      if (!patchRes.ok) {
        throw new Error(String(patchData.error ?? "Falha ao salvar upload"));
      }

      return patchData;
    } catch (error) {
      if (signal?.aborted) throw error;
      if (attempt === RETRY_DELAYS.length - 1) {
        const rawError = extractUploadErrorMessage(error);
        const failRes = await apiFetch(`/api/upload/batches/${batch.id}/files/${record.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            status: "failed",
            error_message: rawError,
          }),
        });
        const failData = (await failRes.json()) as UploadFilePatchResult & { error?: unknown };
        if (failRes.ok) {
          return failData;
        }
        throw error;
      }
    }
  }

  throw new Error("Falha no upload");
}

export async function resetFailedUploadFile(batch: UploadBatch, fileId: string) {
  const res = await apiFetch(`/api/upload/batches/${batch.id}/files/${fileId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      status: "pending",
      bytes_uploaded: 0,
      error_message: null,
      public_url: null,
    }),
  });

  const data = (await res.json()) as UploadFilePatchResult & { error?: unknown };
  if (!res.ok) {
    throw new Error(String(data.error ?? "Falha ao resetar arquivo"));
  }

  return applyBatchFilePatch(batch, data);
}

export async function resetAllFailedUploadFiles(batch: UploadBatch) {
  let next = batch;
  const failed =
    next.upload_files?.filter((file) => !file.removed && file.status === "failed") ?? [];
  for (const file of failed) {
    next = await resetFailedUploadFile(next, file.id);
  }
  return next;
}

export async function fetchActiveBatch(options?: {
  summary?: boolean;
  platform?: UploadBatch["platform"];
  accountId?: string;
}) {
  const params = new URLSearchParams();
  if (options?.summary) params.set("summary", "1");
  if (options?.platform) params.set("platform", options.platform);
  if (options?.accountId) params.set("account_id", options.accountId);
  const query = params.toString();
  const url = query ? `/api/upload/batches?${query}` : "/api/upload/batches";
  const res = await apiFetch(url, { cache: "no-store" });
  const data = await res.json();
  if (!res.ok) throw new Error(String(data.error ?? "Falha ao carregar lote"));
  return (data.batch as UploadBatch | null) ?? null;
}

export async function clearAccountUploadedVideosClient(params: {
  platform: UploadBatch["platform"];
  accountId: string;
}) {
  const res = await apiFetch("/api/upload/account/clear-videos", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      platform: params.platform ?? "instagram",
      account_id: params.accountId,
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(String(data.error ?? "Falha ao apagar vídeos enviados"));
  }
  return data as {
    batchesCleared: number;
    filesCleared: number;
    storagePathsRemoved: number;
    message: string;
  };
}

export async function deleteAccountUploadBatchesClient(params: {
  platform: UploadBatch["platform"];
  accountId: string;
}) {
  const res = await apiFetch("/api/upload/account/clear-batches", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      platform: params.platform ?? "instagram",
      account_id: params.accountId,
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(String(data.error ?? "Falha ao apagar lotes"));
  }
  return data as {
    batchesDeleted: number;
    filesDeleted: number;
    storagePathsRemoved: number;
    message: string;
  };
}

export async function ensureBatchWithFiles(batch: UploadBatch) {
  if (batch.upload_files && batch.upload_files.length > 0) return batch;
  return refreshUploadBatch(batch.id);
}

export async function createUploadBatch(params: {
  accountId: string;
  platform?: UploadBatch["platform"];
  scheduleMode: UploadBatch["schedule_mode"];
  customSchedule?: UploadBatch["custom_schedule"];
  uploadSpeedMode?: UploadSpeedMode;
  files: Array<{ file: File; fingerprint: string }>;
}) {
  const platform = params.platform ?? "instagram";
  const fileChunks = chunkItems(params.files, BATCH_CREATE_CHUNK_SIZE);
  const totalFiles = params.files.length;
  const basePayload = {
    platform,
    account_id: platform === "instagram" ? params.accountId : undefined,
    tiktok_account_id: platform === "tiktok" ? params.accountId : undefined,
    schedule_mode: params.scheduleMode,
    custom_schedule: params.customSchedule ?? undefined,
    upload_speed_mode: params.uploadSpeedMode ?? "turbo",
  };

  const firstRes = await apiFetch("/api/upload/batches", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...basePayload,
      total_files: totalFiles,
      files: serializeUploadFiles(fileChunks[0]),
    }),
  });

  const firstData = await firstRes.json();
  if (!firstRes.ok) {
    throw new Error(String(firstData.error ?? "Falha ao criar lote"));
  }

  let batch = firstData.batch as UploadBatch;

  try {
    for (const chunk of fileChunks.slice(1)) {
      const appendRes = await apiFetch(`/api/upload/batches/${batch.id}/files`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          files: serializeUploadFiles(chunk),
        }),
      });

      const appendData = await appendRes.json();
      if (!appendRes.ok) {
        throw new Error(String(appendData.error ?? "Falha ao adicionar arquivos ao lote"));
      }

      batch = appendFilesToBatch(
        batch,
        appendData.added as UploadBatchFile[],
        appendData.counters as BatchCounters | undefined,
      );
    }
  } catch (error) {
    await apiFetch(`/api/upload/batches/${batch.id}`, { method: "DELETE" }).catch(() => undefined);
    throw error;
  }

  return batch;
}

export async function setBatchPaused(batchId: string, paused: boolean) {
  const res = await apiFetch(`/api/upload/batches/${batchId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ paused }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(String(data.error ?? "Falha ao atualizar lote"));
  return data.batch as UploadBatch;
}

export async function setBatchSpeedMode(batchId: string, uploadSpeedMode: UploadSpeedMode) {
  const res = await apiFetch(`/api/upload/batches/${batchId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ upload_speed_mode: uploadSpeedMode }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(String(data.error ?? "Falha ao salvar velocidade de upload"));
  return data.batch as UploadBatch;
}

export async function updateBatchSchedule(
  batchId: string,
  params: {
    schedule_mode: UploadBatch["schedule_mode"];
    custom_schedule?: UploadBatch["custom_schedule"];
  },
) {
  const res = await apiFetch(`/api/upload/batches/${batchId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      schedule_mode: params.schedule_mode,
      custom_schedule: params.custom_schedule ?? null,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(String(data.error ?? "Falha ao salvar modo de publicação"));
  return data.batch as UploadBatch;
}

export async function cancelUploadBatch(batchId: string) {
  const res = await apiFetch(`/api/upload/batches/${batchId}`, { method: "DELETE" });
  const data = await res.json();
  if (!res.ok) throw new Error(String(data.error ?? "Falha ao cancelar lote"));
}

export async function deleteUploadBatchPermanent(batchId: string) {
  const res = await apiFetch(`/api/upload/batches/${batchId}?permanent=1`, { method: "DELETE" });
  const data = await res.json();
  if (!res.ok) throw new Error(String(data.error ?? "Falha ao apagar lote"));
  return data as {
    success: boolean;
    batchId: string;
    filesDeleted: number;
    storagePathsRemoved: number;
  };
}

export async function refreshUploadBatch(batchId: string) {
  const res = await apiFetch(`/api/upload/batches/${batchId}`, { cache: "no-store" });
  const data = await res.json();
  if (!res.ok) throw new Error(String(data.error ?? "Falha ao atualizar lote"));
  return data.batch as UploadBatch;
}

export async function markBatchFilesScheduled(batchId: string, publicUrls: string[]) {
  const res = await apiFetch(`/api/upload/batches/${batchId}/mark-scheduled`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ public_urls: publicUrls }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(String(data.error ?? "Falha ao marcar vídeos agendados"));
  return data.batch as UploadBatch;
}

export function getCompletedUploadItems(batch: UploadBatch) {
  return (batch.upload_files ?? [])
    .filter((file) => file.status === "completed" && file.public_url && !file.removed)
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((file) => ({
      media_urls: [file.public_url as string],
      filename: file.filename,
    }));
}

export function fileStatusLabel(
  status: UploadBatchFile["status"],
  options?: { stalled?: boolean; retrying?: boolean },
) {
  if (options?.retrying && status !== "completed") return "Tentando novamente…";
  if (options?.stalled && status === "uploading") return "Travado";
  switch (status) {
    case "completed":
      return "Enviado";
    case "uploading":
      return "Enviando…";
    case "failed":
      return "Erro";
    default:
      return "Aguardando";
  }
}

export function buildFileMapFromRecords(files: File[], records: UploadBatchFile[]) {
  const map = new Map<string, File>();
  for (const record of records) {
    const match = files.find((file) => matchFileToRecord(file, [record]));
    if (match) map.set(record.id, match);
  }
  return map;
}
