import type { UploadBatchFile } from "@/lib/types";

export const UPLOAD_CLAIM_CONFLICT_ERROR = "file_already_claimed";

/** Backoff base delays (ms) for claim 409 — 5s, 10s, 20s, 40s + jitter. */
export const UPLOAD_CLAIM_BACKOFF_MS = [5_000, 10_000, 20_000, 40_000] as const;

export type UploadClaimConflictPayload = {
  ok: false;
  error: typeof UPLOAD_CLAIM_CONFLICT_ERROR;
  message: string;
  batchId: string;
  fileId: string;
  currentStatus: string;
  claimedBy: string | null;
  claimedAt: string | null;
  claimExpiresAt: string | null;
  isStale: boolean;
  retryAfterMs: number;
  recommendedAction: "wait_and_reconcile";
};

export class UploadClaimConflictError extends Error {
  readonly code = UPLOAD_CLAIM_CONFLICT_ERROR;
  readonly payload: UploadClaimConflictPayload;
  readonly attempt: number;

  constructor(payload: UploadClaimConflictPayload, attempt = 0) {
    super(payload.message);
    this.name = "UploadClaimConflictError";
    this.payload = payload;
    this.attempt = attempt;
  }
}

export function claimBackoffWithJitter(attempt: number): number {
  const index = Math.min(Math.max(attempt, 0), UPLOAD_CLAIM_BACKOFF_MS.length - 1);
  const base = UPLOAD_CLAIM_BACKOFF_MS[index] ?? 40_000;
  const jitter = Math.floor(Math.random() * 1_500);
  return base + jitter;
}

export function isClaimConflictMessage(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("reservado por outro worker") ||
    lower.includes("file_already_claimed") ||
    lower.includes("arquivo em uso")
  );
}

export function buildUploadClaimConflictPayload(params: {
  batchId: string;
  fileId: string;
  file: UploadBatchFile;
  attempt?: number;
  now?: Date;
}): UploadClaimConflictPayload {
  const now = params.now ?? new Date();
  const leaseUntil = params.file.lease_until ? new Date(params.file.lease_until) : null;
  const isStale = !leaseUntil || leaseUntil.getTime() <= now.getTime();
  const attempt = params.attempt ?? 0;

  return {
    ok: false,
    error: UPLOAD_CLAIM_CONFLICT_ERROR,
    message: "Arquivo reservado por outro worker — aguardando reconciliação",
    batchId: params.batchId,
    fileId: params.fileId,
    currentStatus: params.file.status,
    claimedBy: params.file.worker_id ?? null,
    claimedAt: params.file.updated_at ?? null,
    claimExpiresAt: params.file.lease_until ?? null,
    isStale,
    retryAfterMs: claimBackoffWithJitter(attempt),
    recommendedAction: "wait_and_reconcile",
  };
}
