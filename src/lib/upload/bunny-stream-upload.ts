import * as tus from "tus-js-client";
import { buildTusFingerprint } from "@/lib/upload/progress-guard";
import {
  TUS_CHUNK_SIZE,
  UPLOAD_FILE_TIMEOUT_MS,
  UPLOAD_STALL_TIMEOUT_MS,
} from "@/lib/upload/storage-config";

export type BunnyStreamPrepareResponse = {
  provider: "bunny-stream";
  tusEndpoint: string;
  libraryId: string;
  videoId: string;
  authorizationSignature: string;
  authorizationExpire: number;
  path: string;
  publicUrl: string;
  contentType: string;
  chunkSize: number;
  fileId: string;
  batchId: string;
};

export function uploadFileWithBunnyStream(params: {
  file: File;
  prepare: BunnyStreamPrepareResponse;
  batchId: string;
  recordId: string;
  onProgress?: (loaded: number, total: number) => void;
  signal?: AbortSignal;
  resumePrevious?: boolean;
}) {
  const logTus = (event: string, detail?: Record<string, unknown>) => {
    if (typeof console !== "undefined") {
      console.info(`[upload-bunny-stream] ${event}`, {
        batchId: params.batchId,
        fileId: params.recordId,
        filename: params.file.name,
        videoId: params.prepare.videoId,
        ...detail,
      });
    }
  };

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
      logTus("stall_timeout", { timeoutMs: UPLOAD_STALL_TIMEOUT_MS });
      uploadRef?.abort(true);
      reject(new Error("UPLOAD_STALL_DETECTED"));
    }, UPLOAD_STALL_TIMEOUT_MS);
  };

  const chunkSize = params.prepare.chunkSize || TUS_CHUNK_SIZE;

  const promise = new Promise<void>((resolve, reject) => {
    const upload = new tus.Upload(params.file, {
      endpoint: params.prepare.tusEndpoint,
      retryDelays: [0, 3000, 5000, 10000, 20000, 30000, 60000],
      headers: {
        AuthorizationSignature: params.prepare.authorizationSignature,
        AuthorizationExpire: String(params.prepare.authorizationExpire),
        VideoId: params.prepare.videoId,
        LibraryId: params.prepare.libraryId,
      },
      chunkSize,
      removeFingerprintOnSuccess: true,
      metadata: {
        filetype: params.prepare.contentType,
        title: params.file.name,
      },
      storeFingerprintForResuming: params.resumePrevious !== false,
      fingerprint: () => {
        const base = buildTusFingerprint(params.batchId, params.recordId, params.file);
        if (params.resumePrevious === false) {
          return Promise.resolve(`${base}:bunny-stream:${params.prepare.videoId}:fresh:${Date.now()}`);
        }
        return Promise.resolve(`${base}:bunny-stream:${params.prepare.videoId}`);
      },
      onProgress: (bytesUploaded, bytesTotal) => {
        resetStallTimer(reject);
        params.onProgress?.(bytesUploaded, bytesTotal);
      },
      onBeforeRequest: () => {
        resetStallTimer(reject);
      },
      onShouldRetry(error) {
        resetStallTimer(reject);
        const status = (error as { originalResponse?: { getStatus?: () => number } }).originalResponse
          ?.getStatus?.();
        if (status === 401 || status === 403 || status === 404 || status === 409) return false;
        logTus("retry", { status, resumePrevious: params.resumePrevious });
        return true;
      },
      onError: (error) => {
        clearTimers();
        if (abortedByUser) {
          reject(new DOMException("Upload pausado", "AbortError"));
          return;
        }
        logTus("error", { message: error instanceof Error ? error.message : String(error) });
        reject(error);
      },
      onSuccess: () => {
        clearTimers();
        logTus("completed", { size: params.file.size });
        resolve();
      },
    });

    uploadRef = upload;

    absoluteTimer = setTimeout(() => {
      logTus("absolute_timeout", { timeoutMs: UPLOAD_FILE_TIMEOUT_MS });
      upload.abort(true);
      reject(new Error("Tempo máximo de upload excedido — tentando novamente…"));
    }, UPLOAD_FILE_TIMEOUT_MS);

    if (params.signal) {
      params.signal.addEventListener(
        "abort",
        () => {
          abortedByUser = true;
          clearTimers();
          logTus("abort_signal");
          upload.abort(false);
        },
        { once: true },
      );
    }

    resetStallTimer(reject);
    logTus("start", { resumePrevious: params.resumePrevious, size: params.file.size });

    upload
      .findPreviousUploads()
      .then((previousUploads) => {
        if (params.resumePrevious !== false && previousUploads.length > 0) {
          logTus("resume_previous", { count: previousUploads.length });
          upload.resumeFromPreviousUpload(previousUploads[0]);
        }
        upload.start();
      })
      .catch((error) => {
        clearTimers();
        logTus("start_failed", { message: error instanceof Error ? error.message : String(error) });
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
