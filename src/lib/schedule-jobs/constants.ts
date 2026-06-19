/** Vídeos processados por chamada advance (legendas + plano). */
export const SCHEDULE_JOB_PLAN_CHUNK = 15;

/** Posts inseridos por transação no advance. */
export const SCHEDULE_JOB_INSERT_CHUNK = 25;

/** Acima disso, forçar fila de job em vez de fluxo síncrono. */
export const SCHEDULE_JOB_FORCE_THRESHOLD = 30;

/** Aviso para lotes grandes. */
export const SCHEDULE_JOB_LARGE_BATCH_THRESHOLD = 100;

/** Itens inseridos por vez ao criar o job. */
export const SCHEDULE_JOB_CREATE_CHUNK = 100;

export const SCHEDULE_JOB_MAX_ATTEMPTS = 3;
