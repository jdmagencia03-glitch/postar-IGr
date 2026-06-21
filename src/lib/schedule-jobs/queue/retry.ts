import { QUEUE_RETRY_BACKOFF_MS, QUEUE_TASK_MAX_ATTEMPTS } from "@/lib/schedule-jobs/queue/constants";

export function nextRetryAt(attemptCount: number, now = Date.now()): Date | null {
  if (attemptCount >= QUEUE_TASK_MAX_ATTEMPTS) return null;
  const index = Math.min(attemptCount - 1, QUEUE_RETRY_BACKOFF_MS.length - 1);
  const delay = QUEUE_RETRY_BACKOFF_MS[Math.max(0, index)] ?? 900_000;
  return new Date(now + delay);
}

export function isRetryDue(nextRetryAt: string | null, now = Date.now()) {
  if (!nextRetryAt) return true;
  return new Date(nextRetryAt).getTime() <= now;
}
