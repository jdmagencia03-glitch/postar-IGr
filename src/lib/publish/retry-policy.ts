import type { PostStatus } from "@/lib/types";

export const MAX_PUBLISH_RETRIES = 3;

/** Cooldown em ms após cada falha (1ª, 2ª, 3ª tentativa). */
export const RETRY_COOLDOWN_MS = [5 * 60_000, 15 * 60_000, 60 * 60_000] as const;

export function retryCooldownMs(retryCount: number) {
  const index = Math.max(0, Math.min(retryCount - 1, RETRY_COOLDOWN_MS.length - 1));
  return RETRY_COOLDOWN_MS[index];
}

export function nextRetryAtFromCount(retryCount: number, now = new Date()) {
  return new Date(now.getTime() + retryCooldownMs(retryCount)).toISOString();
}

export function isRetryEligibleStatus(status: PostStatus) {
  return status === "failed" || status === "retrying" || status === "failed_persistent";
}

export function isActiveQueueStatus(status: PostStatus) {
  return (
    status === "pending" ||
    status === "processing" ||
    status === "retrying"
  );
}

export function isTerminalFailureStatus(status: PostStatus) {
  return status === "failed_persistent" || status === "cancelled";
}
