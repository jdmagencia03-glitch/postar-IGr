import type { UploadBatch, UploadBatchFile, UploadSpeedMode } from "@/lib/types";
import { uploadFileWithTus, type TusPrepareResponse } from "@/lib/upload/tus-upload";

const RETRY_DELAYS = [0, 3000, 10000, 30000];

async function apiFetch(input: RequestInfo | URL, init?: RequestInit) {
  const response = await fetch(input, {
    ...init,
    credentials: "include",
  });

  if (response.status === 401) {
    window.location.href = "/login?next=/dashboard/bulk";
    throw new Error("Sessão expirada. Faça login novamente.");
  }

  return response;
}

export function matchFileToRecord(file: File, records: UploadBatchFile[]) {
  const fingerprint = `${file.name}|${file.size}|${file.lastModified}`;
  return records.find(
    (record) =>
      record.file_hash === fingerprint ||
      (record.filename === file.name && Number(record.file_size) === file.size),
  );
}

export async function uploadBatchFile(params: {
  batch: UploadBatch;
  record: UploadBatchFile;
  file: File;
  signal?: AbortSignal;
  onProgress?: (bytesUploaded: number, bytesTotal: number) => void;
}) {
  const { batch, record, file, onProgress, signal } = params;

  for (let attempt = 0; attempt < RETRY_DELAYS.length; attempt++) {
    if (signal?.aborted) {
      throw new DOMException("Upload pausado", "AbortError");
    }

    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS[attempt]));
    }

    try {
      await apiFetch(`/api/upload/batches/${batch.id}/files/${record.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "uploading",
          bytes_uploaded: Number(record.bytes_uploaded ?? 0),
          error_message: null,
        }),
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

      let lastDbSync = 0;
      const { promise } = uploadFileWithTus({
        file,
        prepare: prepareData,
        batchId: batch.id,
        recordId: record.id,
        signal,
        onProgress: async (loaded, total) => {
          onProgress?.(loaded, total);
          if (loaded - lastDbSync >= 4 * 1024 * 1024 || loaded === total) {
            lastDbSync = loaded;
            await apiFetch(`/api/upload/batches/${batch.id}/files/${record.id}`, {
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

      const patchData = await patchRes.json();
      if (!patchRes.ok) {
        throw new Error(String(patchData.error ?? "Falha ao salvar upload"));
      }

      return patchData.batch as UploadBatch;
    } catch (error) {
      if (signal?.aborted) throw error;
      if (attempt === RETRY_DELAYS.length - 1) {
        await apiFetch(`/api/upload/batches/${batch.id}/files/${record.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            status: "failed",
            error_message: error instanceof Error ? error.message : "Erro no upload",
          }),
        });
        throw error;
      }
    }
  }

  throw new Error("Falha no upload");
}

export async function fetchActiveBatch() {
  const res = await apiFetch("/api/upload/batches", { cache: "no-store" });
  const data = await res.json();
  if (!res.ok) throw new Error(String(data.error ?? "Falha ao carregar lote"));
  return (data.batch as UploadBatch | null) ?? null;
}

export async function createUploadBatch(params: {
  accountId: string;
  scheduleMode: UploadBatch["schedule_mode"];
  customSchedule?: UploadBatch["custom_schedule"];
  uploadSpeedMode?: UploadSpeedMode;
  files: Array<{ file: File; fingerprint: string }>;
}) {
  const res = await apiFetch("/api/upload/batches", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      account_id: params.accountId,
      schedule_mode: params.scheduleMode,
      custom_schedule: params.customSchedule ?? undefined,
      upload_speed_mode: params.uploadSpeedMode ?? "normal",
      files: params.files.map(({ file, fingerprint }) => ({
        filename: file.name,
        file_size: file.size,
        content_type: file.type || "video/mp4",
        file_hash: fingerprint,
        last_modified: file.lastModified,
      })),
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(String(data.error ?? "Falha ao criar lote"));
  }

  return data.batch as UploadBatch;
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

export async function cancelUploadBatch(batchId: string) {
  const res = await apiFetch(`/api/upload/batches/${batchId}`, { method: "DELETE" });
  const data = await res.json();
  if (!res.ok) throw new Error(String(data.error ?? "Falha ao cancelar lote"));
}

export async function refreshUploadBatch(batchId: string) {
  const res = await apiFetch(`/api/upload/batches/${batchId}`, { cache: "no-store" });
  const data = await res.json();
  if (!res.ok) throw new Error(String(data.error ?? "Falha ao atualizar lote"));
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

export function fileStatusLabel(status: UploadBatchFile["status"]) {
  switch (status) {
    case "completed":
      return "Enviado";
    case "uploading":
      return "Enviando";
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
