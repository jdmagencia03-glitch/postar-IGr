/** Vídeos processados por chamada advance (legendas + plano). Alinhado ao autopilot (50). */
export const SCHEDULE_JOB_PLAN_CHUNK = 50;

/** Posts inseridos por transação no advance. */
export const SCHEDULE_JOB_INSERT_CHUNK = 50;

/** Acima disso, forçar fila de job em vez de fluxo síncrono. */
export const SCHEDULE_JOB_FORCE_THRESHOLD = 1;

/** Aviso para lotes grandes. */
export const SCHEDULE_JOB_LARGE_BATCH_THRESHOLD = 100;

/** Itens inseridos por vez ao criar o job. */
export const SCHEDULE_JOB_CREATE_CHUNK = 100;

/** Tentativas máximas por item antes de marcar failed. */
export const SCHEDULE_JOB_MAX_ATTEMPTS = 3;

/** TTL do lock do worker (ms). */
export const SCHEDULE_JOB_LOCK_TTL_MS = 360_000;

/** Heartbeat recente = worker ativo (ms). */
export const SCHEDULE_JOB_WORKER_ACTIVE_MS = 90_000;

/** Job sem progresso = stale (ms) — 10 min */
export const SCHEDULE_JOB_STALE_MS = 600_000;

/** Fase saving_posts sem worker ativo (ms) — 3 min */
export const SCHEDULE_JOB_SAVE_STALL_MS = 180_000;

/** Chunks por job em cada execução do cron (background, até maxDuration). */
export const SCHEDULE_JOB_CRON_CHUNKS_PER_JOB = 10;

/** Jobs processados por execução do cron. */
export const SCHEDULE_JOB_CRON_MAX_JOBS = 3;
