/** Máximo de vídeos por requisição API (evita timeout Vercel) */
export const API_BATCH_SIZE = 50;

/** Máximo total de vídeos por sessão de upload */
export const MAX_VIDEOS_TOTAL = 300;

/** Tamanho do lote para geração de legendas GPT */
export const CAPTION_BATCH_SIZE = 25;

/** Máximo de vídeos com prévia detalhada por vídeo */
export const MAX_PREVIEW_VIDEOS = 50;

/** Tamanho do lote de upload paralelo */
export const UPLOAD_BATCH_SIZE = 20;
