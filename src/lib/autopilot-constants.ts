/** Máximo de vídeos por requisição API (evita timeout Vercel) */
export const API_BATCH_SIZE = 50;

export { BATCH_CREATE_CHUNK_SIZE } from "@/lib/upload/storage-config";

/** Limite estável por lote enquanto o processamento em massa é otimizado. */
export const MAX_VIDEOS_TOTAL = 50;

export const STABILITY_BATCH_LIMIT_MESSAGE =
  "Para manter estabilidade enquanto o processamento em massa é otimizado, envie até 50 vídeos por lote.";

/** Tamanho do lote para geração de legendas GPT */
export const CAPTION_BATCH_SIZE = 25;

/** Máximo de vídeos com prévia detalhada por vídeo */
export const MAX_PREVIEW_VIDEOS = 50;

/** Tamanho do lote de upload paralelo */
export const UPLOAD_BATCH_SIZE = 20;
