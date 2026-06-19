import * as tus from "tus-js-client";
import {
  STORAGE_CACHE_CONTROL,
  TUS_CHUNK_SIZE,
  UPLOAD_FILE_TIMEOUT_MS,
  UPLOAD_STALL_TIMEOUT_MS,
} from "@/lib/upload/storage-config";

export interface TusPrepareResponse {
  tusEndpoint: string;
  signature: string;
  path: string;
  publicUrl: string;
  contentType: string;
  chunkSize: number;
}

export function buildTusFingerprint(batchId: string, recordId: string, file: File) {
  return `postarigr:${batchId}:${recordId}:${file.name}:${file.size}:${file.lastModified}`;
}

export function uploadFileWithTus(params: {
  file: File;
  prepare: TusPrepareResponse;
  batchId: string;
  recordId: string;
  onProgress?: (loaded: number, total: number) => void;
  signal?: AbortSignal;
  /** Retoma chunk parcial salvo no navegador. Desligue após falha para reenviar do zero. */
  resumePrevious?: boolean;
}) {
  let uploadRef: tus.Upload | null = null;
  let abortedByUser = false;
  let stallTimer: ReturnType<typeof setTimeout> | null = null;
  let absoluteTimer: ReturnType<typeof setTimeout> | null = null;

  const clearTimers = () => {
    if (stallTimer) {
      clearTimeout(stallTimer);
      stallTimer = null;
    }
    if (absoluteTimer) {
      clearTimeout(absoluteTimer);
      absoluteTimer = null;
    }
  };

  const resetStallTimer = (reject: (error: Error) => void) => {
    if (stallTimer) clearTimeout(stallTimer);
    stallTimer = setTimeout(() => {
      uploadRef?.abort(true);
      reject(new Error("Upload sem progresso — reconectando automaticamente…"));
    }, UPLOAD_STALL_TIMEOUT_MS);
  };

  const chunkSize = params.prepare.chunkSize || TUS_CHUNK_SIZE;
  // Supabase: só enviar dados no POST inicial se couber em 1 chunk (≤6MB).
  // Arquivos maiores precisam de PATCH sequencial — senão trava ~11% (1º chunk).
  const uploadDataDuringCreation = params.file.size <= chunkSize;

  const promise = new Promise<void>((resolve, reject) => {
    const upload = new tus.Upload(params.file, {
      endpoint: params.prepare.tusEndpoint,
      retryDelays: [0, 3000, 5000, 10000, 20000, 30000, 60000],
      headers: {
        "x-signature": params.prepare.signature,
        "x-upsert": "true",
      },
      uploadDataDuringCreation,
      removeFingerprintOnSuccess: true,
      metadata: {
        bucketName: "media",
        objectName: params.prepare.path,
        contentType: params.prepare.contentType,
        cacheControl: STORAGE_CACHE_CONTROL,
      },
      chunkSize,
      storeFingerprintForResuming: params.resumePrevious !== false,
      fingerprint: () => {
        const base = buildTusFingerprint(params.batchId, params.recordId, params.file);
        if (params.resumePrevious === false) {
          return Promise.resolve(`${base}:fresh:${Date.now()}`);
        }
        return Promise.resolve(base);
      },
      onProgress: (bytesUploaded, bytesTotal) => {
        resetStallTimer(reject);
        params.onProgress?.(bytesUploaded, bytesTotal);
      },
      onShouldRetry(error) {
        const status = (error as { originalResponse?: { getStatus?: () => number } }).originalResponse
          ?.getStatus?.();
        if (status === 403 || status === 404) return false;
        return true;
      },
      onError: (error) => {
        clearTimers();
        if (abortedByUser) {
          reject(new DOMException("Upload pausado", "AbortError"));
          return;
        }
        reject(error);
      },
      onSuccess: () => {
        clearTimers();
        resolve();
      },
    });

    uploadRef = upload;

    absoluteTimer = setTimeout(() => {
      upload.abort(true);
      reject(new Error("Tempo máximo de upload excedido — tentando novamente…"));
    }, UPLOAD_FILE_TIMEOUT_MS);

    if (params.signal) {
      params.signal.addEventListener(
        "abort",
        () => {
          abortedByUser = true;
          clearTimers();
          upload.abort(false);
        },
        { once: true },
      );
    }

    upload
      .findPreviousUploads()
      .then((previousUploads) => {
        if (params.resumePrevious !== false && previousUploads.length > 0) {
          upload.resumeFromPreviousUpload(previousUploads[0]);
        }
        resetStallTimer(reject);
        upload.start();
      })
      .catch((error) => {
        clearTimers();
        reject(error);
      });
  });

  return {
    promise,
    abort: (terminate = false) => {
      abortedByUser = true;
      clearTimers();
      uploadRef?.abort(terminate);
    },
  };
}
