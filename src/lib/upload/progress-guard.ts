import { isUploadDebugEnabled } from "@/lib/upload/debug";

let activeBatchId: string | null = null;

let staleBatchEventsIgnored = 0;
let missingBatchOrFileEventsIgnored = 0;
let progressRegressionsIgnored = 0;

const maxPercentByFile = new Map<string, number>();
const maxPercentByBatch = new Map<string, number>();
const maxBytesByBatch = new Map<string, number>();

function fileKey(batchId: string, fileId: string) {
  return `${batchId}:${fileId}`;
}

export function setActiveUploadBatchId(batchId: string | null) {
  if (activeBatchId && batchId && activeBatchId !== batchId) {
    resetProgressGuardForBatch(activeBatchId);
  }
  activeBatchId = batchId;
}

export function getActiveUploadBatchId() {
  return activeBatchId;
}

export function getProgressGuardStats() {
  return {
    staleBatchEventsIgnored,
    missingBatchOrFileEventsIgnored,
    progressRegressionsIgnored,
  };
}

export function resetProgressGuardCounters() {
  staleBatchEventsIgnored = 0;
  missingBatchOrFileEventsIgnored = 0;
  progressRegressionsIgnored = 0;
}

export function resetProgressGuardForBatch(batchId: string) {
  maxPercentByBatch.delete(batchId);
  maxBytesByBatch.delete(batchId);
  const prefix = `${batchId}:`;
  for (const key of maxPercentByFile.keys()) {
    if (key.startsWith(prefix)) maxPercentByFile.delete(key);
  }
}

export type ProgressEventContext = {
  batchId?: string | null;
  fileId?: string | null;
  source?: string;
};

function logIgnoredRegression(payload: Record<string, unknown>) {
  if (!isUploadDebugEnabled()) return;
  console.info("[upload-progress-regression]", { ...payload, ignored: true });
}

export function ignoreProgressEvent(
  context: ProgressEventContext,
  reason: string,
): boolean {
  if (reason === "stale_or_missing_batch_id") staleBatchEventsIgnored += 1;
  if (reason === "missing_file_id" || reason === "missing_batch_id") {
    missingBatchOrFileEventsIgnored += 1;
  }
  if (isUploadDebugEnabled()) {
    console.info("[upload-progress-ignored]", { ...context, reason });
  }
  return false;
}

/** Valida evento de lote — retorna false se deve ignorar. */
export function validateBatchProgressEvent(batchId?: string | null): batchId is string {
  if (!batchId) {
    missingBatchOrFileEventsIgnored += 1;
    if (isUploadDebugEnabled()) {
      console.info("[upload-progress-ignored]", { reason: "missing_batch_id" });
    }
    return false;
  }
  if (activeBatchId && batchId !== activeBatchId) {
    staleBatchEventsIgnored += 1;
    if (isUploadDebugEnabled()) {
      console.info("[upload-progress-ignored]", {
        batchId,
        activeBatchId,
        reason: "stale_or_missing_batch_id",
      });
    }
    return false;
  }
  return true;
}

/** Valida evento por arquivo — retorna false se deve ignorar. */
export function validateFileProgressEvent(
  batchId: string | null | undefined,
  fileId?: string | null,
): fileId is string {
  if (!validateBatchProgressEvent(batchId)) return false;
  if (!fileId) {
    missingBatchOrFileEventsIgnored += 1;
    if (isUploadDebugEnabled()) {
      console.info("[upload-progress-ignored]", { batchId, reason: "missing_file_id" });
    }
    return false;
  }
  return true;
}

export function applyMonotonicFilePercent(
  batchId: string,
  fileId: string,
  newPercent: number,
  context?: { source?: string },
): number {
  if (!validateBatchProgressEvent(batchId)) return newPercent;
  const key = fileKey(batchId, fileId);
  const prev = maxPercentByFile.get(key) ?? 0;
  if (newPercent < prev) {
    progressRegressionsIgnored += 1;
    logIgnoredRegression({
      batchId,
      fileId,
      previousPercent: prev,
      newPercent,
      source: context?.source ?? "file",
    });
    return prev;
  }
  if (newPercent > prev) {
    maxPercentByFile.set(key, newPercent);
  }
  return Math.max(prev, newPercent);
}

export function applyMonotonicBatchProgress(
  batchId: string,
  computedPercent: number,
  computedBytes: number,
  context?: { source?: string },
): { progressPercent: number; displayUploadedBytes: number } {
  if (!validateBatchProgressEvent(batchId)) {
    return {
      progressPercent: computedPercent,
      displayUploadedBytes: computedBytes,
    };
  }

  const prevPercent = maxPercentByBatch.get(batchId) ?? 0;
  const prevBytes = maxBytesByBatch.get(batchId) ?? 0;

  if (computedPercent < prevPercent || computedBytes < prevBytes) {
    progressRegressionsIgnored += 1;
    logIgnoredRegression({
      batchId,
      previousPercent: prevPercent,
      newPercent: computedPercent,
      previousBytes: prevBytes,
      newBytes: computedBytes,
      source: context?.source ?? "batch",
    });
  }

  const nextPercent = Math.max(prevPercent, computedPercent);
  const nextBytes = Math.max(prevBytes, computedBytes);
  maxPercentByBatch.set(batchId, nextPercent);
  maxBytesByBatch.set(batchId, nextBytes);
  return { progressPercent: nextPercent, displayUploadedBytes: nextBytes };
}

/** Remove entradas TUS de outros lotes no localStorage. */
export function cleanupStaleTusEntries(options?: {
  keepBatchId?: string | null;
  maxAgeHours?: number;
}) {
  if (typeof localStorage === "undefined") {
    return { removed: 0, scanned: 0 };
  }

  const keepBatchId = options?.keepBatchId ?? null;
  let removed = 0;
  let scanned = 0;
  const keys: string[] = [];

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key) keys.push(key);
  }

  for (const key of keys) {
    if (!key.startsWith("tus::")) continue;
    scanned += 1;
    if (!key.includes("postarigr:")) continue;

    const belongsToKept =
      keepBatchId != null && key.includes(`postarigr:${keepBatchId}:`);
    if (belongsToKept) continue;

    try {
      localStorage.removeItem(key);
      removed += 1;
    } catch {
      // ignore quota / private mode
    }
  }

  if (removed > 0 && isUploadDebugEnabled()) {
    console.info("[upload-tus-cleanup]", { removed, scanned, keepBatchId });
  }

  return { removed, scanned };
}

export function filterTusFingerprintsForBatch(batchId: string, fingerprint: string) {
  return fingerprint.startsWith(`postarigr:${batchId}:`);
}

export function buildTusFingerprint(batchId: string, recordId: string, file: File) {
  return `postarigr:${batchId}:${recordId}:${file.name}:${file.size}:${file.lastModified}`;
}
