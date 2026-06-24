import { STORAGE_CACHE_CONTROL, UPLOAD_FILE_TIMEOUT_MS, UPLOAD_STALL_TIMEOUT_MS } from "@/lib/upload/storage-config";
import type { BunnyStreamPrepareResponse } from "@/lib/upload/bunny-stream-upload";

export type BunnyStoragePrepareResponse = {
  provider: "bunny-storage";
  uploadUrl: string;
  accessKey: string;
  path: string;
  publicUrl: string;
  contentType: string;
  fileId: string;
  batchId: string;
};

export type TusPrepareResponse = {
  provider?: "supabase";
  tusEndpoint: string;
  signature: string;
  path: string;
  publicUrl: string;
  contentType: string;
  chunkSize: number;
  fileId: string;
  batchId: string;
  signedUrl?: string;
};

export type { BunnyStreamPrepareResponse };

export type MediaPrepareResponse =
  | BunnyStoragePrepareResponse
  | BunnyStreamPrepareResponse
  | TusPrepareResponse;

/** @deprecated use BunnyStoragePrepareResponse */
export type BunnyPrepareResponse = BunnyStoragePrepareResponse;

export function isBunnyStreamPrepare(
  prepare: MediaPrepareResponse,
): prepare is BunnyStreamPrepareResponse {
  return prepare.provider === "bunny-stream";
}

export function isBunnyStoragePrepare(
  prepare: MediaPrepareResponse,
): prepare is BunnyStoragePrepareResponse {
  return prepare.provider === "bunny-storage" || ("uploadUrl" in prepare && !isBunnyStreamPrepare(prepare));
}

export function isBunnyPrepare(prepare: MediaPrepareResponse): prepare is BunnyStoragePrepareResponse {
  return isBunnyStoragePrepare(prepare);
}

export function uploadFileToBunny(params: {
  file: File;
  prepare: BunnyStoragePrepareResponse;
  batchId: string;
  recordId: string;
  onProgress?: (loaded: number, total: number) => void;
  signal?: AbortSignal;
}) {
  const log = (event: string, detail?: Record<string, unknown>) => {
    if (typeof console !== "undefined") {
      console.info(`[upload-bunny-storage] ${event}`, {
        batchId: params.batchId,
        fileId: params.recordId,
        filename: params.file.name,
        ...detail,
      });
    }
  };

  let xhr: XMLHttpRequest | null = null;
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
      log("stall_timeout", { timeoutMs: UPLOAD_STALL_TIMEOUT_MS });
      xhr?.abort();
      reject(new Error("UPLOAD_STALL_DETECTED"));
    }, UPLOAD_STALL_TIMEOUT_MS);
  };

  const promise = new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();
    xhr = request;
    request.open("PUT", params.prepare.uploadUrl, true);
    request.setRequestHeader("AccessKey", params.prepare.accessKey);
    request.setRequestHeader("Content-Type", params.prepare.contentType);
    request.setRequestHeader("Cache-Control", STORAGE_CACHE_CONTROL);

    request.upload.onprogress = (event) => {
      resetStallTimer(reject);
      if (event.lengthComputable) {
        params.onProgress?.(event.loaded, event.total);
      }
    };

    request.onload = () => {
      clearTimers();
      if (abortedByUser) {
        reject(new DOMException("Upload pausado", "AbortError"));
        return;
      }
      if (request.status >= 200 && request.status < 300) {
        log("completed", { size: params.file.size, status: request.status });
        resolve();
        return;
      }
      log("http_error", { status: request.status, response: request.responseText?.slice(0, 200) });
      reject(new Error(`Bunny upload falhou (HTTP ${request.status})`));
    };

    request.onerror = () => {
      clearTimers();
      if (abortedByUser) {
        reject(new DOMException("Upload pausado", "AbortError"));
        return;
      }
      reject(new Error("Falha de rede ao enviar para Bunny"));
    };

    request.onabort = () => {
      clearTimers();
      reject(new DOMException("Upload pausado", "AbortError"));
    };

    if (params.signal) {
      params.signal.addEventListener(
        "abort",
        () => {
          abortedByUser = true;
          clearTimers();
          log("abort_signal");
          request.abort();
        },
        { once: true },
      );
    }

    absoluteTimer = setTimeout(() => {
      log("absolute_timeout", { timeoutMs: UPLOAD_FILE_TIMEOUT_MS });
      request.abort();
      reject(new Error("Tempo máximo de upload excedido — tentando novamente…"));
    }, UPLOAD_FILE_TIMEOUT_MS);

    resetStallTimer(reject);
    log("start", { size: params.file.size });
    request.send(params.file);
  });

  return {
    promise,
    abort: () => {
      abortedByUser = true;
      clearTimers();
      xhr?.abort();
    },
  };
}
