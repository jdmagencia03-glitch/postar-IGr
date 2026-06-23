/** Máximo de vídeos por requisição API (evita timeout Vercel) */
export const API_BATCH_SIZE = 50;

export {
  BATCH_CREATE_CHUNK_SIZE,
  MAX_VIDEOS_PER_BATCH as MAX_VIDEOS_TOTAL,
} from "@/lib/upload/storage-config";

/** Mensagem quando o lote grande segue em fila no servidor. */
export const LARGE_BATCH_QUEUE_MESSAGE =
  "Seu lote foi recebido. Vamos processar os vídeos em fila. Você pode sair da página e acompanhar o progresso depois.";

/** Tamanho do lote para geração de legendas GPT */export const CAPTION_BATCH_SIZE = 25;

/** Máximo de vídeos com prévia detalhada por vídeo */
export const MAX_PREVIEW_VIDEOS = 50;

/** Tamanho do lote de upload paralelo */
export const UPLOAD_BATCH_SIZE = 20;
