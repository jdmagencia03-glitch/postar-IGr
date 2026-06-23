/** Chunks por fase — concorrência controlada, não limite de total do lote. */
export const QUEUE_CAPTION_CHUNK = 5;
export const QUEUE_CALENDAR_CHUNK = 10;
export const QUEUE_SAVE_CHUNK = 10;

/** Concorrência global por execução de drain */
export const QUEUE_MAX_TASKS_PER_DRAIN = 15;
export const QUEUE_MAX_AI_TASKS_PER_DRAIN = 3;
export const QUEUE_MAX_SAVE_PHASE_JOBS_PER_ACCOUNT = 3;

export const QUEUE_MAX_ACTIVE_JOBS_PER_USER = 2;

/** Tempo máximo por execução do cron (ms) */
export const QUEUE_CRON_MAX_MS = 25_000;

/** Lock de task (ms) */
export const QUEUE_TASK_LOCK_MS = 300_000;
export const QUEUE_TASK_HEARTBEAT_MS = 90_000;

/** Job travado sem progresso (ms) */
export const QUEUE_JOB_STUCK_MS = 600_000;

/** Retry backoff (ms): 30s, 2m, 5m, 15m */
export const QUEUE_RETRY_BACKOFF_MS = [30_000, 120_000, 300_000, 900_000] as const;
export const QUEUE_TASK_MAX_ATTEMPTS = 5;
