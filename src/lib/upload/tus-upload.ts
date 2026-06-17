import * as tus from "tus-js-client";
import { STORAGE_CACHE_CONTROL, TUS_CHUNK_SIZE } from "@/lib/upload/storage-config";

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

  const promise = new Promise<void>((resolve, reject) => {
    const upload = new tus.Upload(params.file, {
      endpoint: params.prepare.tusEndpoint,
      retryDelays: [0, 3000, 10000, 30000],
      headers: {
        "x-signature": params.prepare.signature,
        "x-upsert": "true",
      },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      metadata: {
        bucketName: "media",
        objectName: params.prepare.path,
        contentType: params.prepare.contentType,
        cacheControl: STORAGE_CACHE_CONTROL,
      },
      chunkSize: params.prepare.chunkSize || TUS_CHUNK_SIZE,
      storeFingerprintForResuming: params.resumePrevious !== false,
      fingerprint: () => {
        const base = buildTusFingerprint(params.batchId, params.recordId, params.file);
        if (params.resumePrevious === false) {
          return Promise.resolve(`${base}:fresh:${Date.now()}`);
        }
        return Promise.resolve(base);
      },
      onProgress: (bytesUploaded, bytesTotal) => {
        params.onProgress?.(bytesUploaded, bytesTotal);
      },
      onError: (error) => {
        if (abortedByUser) {
          reject(new DOMException("Upload pausado", "AbortError"));
          return;
        }
        reject(error);
      },
      onSuccess: () => resolve(),
    });

    uploadRef = upload;

    if (params.signal) {
      params.signal.addEventListener(
        "abort",
        () => {
          abortedByUser = true;
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
        upload.start();
      })
      .catch(reject);
  });

  return {
    promise,
    abort: (terminate = false) => {
      abortedByUser = true;
      uploadRef?.abort(terminate);
    },
  };
}
