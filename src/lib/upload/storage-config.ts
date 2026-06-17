function readPositiveInt(value: string | undefined, fallback: number) {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Tamanho máximo por vídeo validado pelo app (padrão 500 MB). */
export const MAX_UPLOAD_MB = readPositiveInt(
  process.env.SUPABASE_MAX_UPLOAD_MB ?? process.env.NEXT_PUBLIC_SUPABASE_MAX_UPLOAD_MB,
  500,
);

export const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;

/** Vídeos por lote de upload. */
export const MAX_VIDEOS_PER_BATCH = readPositiveInt(process.env.MAX_VIDEOS_PER_BATCH, 10_000);

/** Metadados por requisição ao criar lote (payload Vercel). */
export const BATCH_CREATE_CHUNK_SIZE = readPositiveInt(process.env.UPLOAD_BATCH_CHUNK_SIZE, 800);

/** Linhas inseridas por vez no Postgres ao registrar arquivos. */
export const DB_INSERT_CHUNK_SIZE = readPositiveInt(process.env.UPLOAD_DB_CHUNK_SIZE, 500);

/** Supabase TUS exige mínimo de 6MB por chunk (não aumentar). */
export const TUS_CHUNK_SIZE = 6 * 1024 * 1024;

export const UPLOAD_PROGRESS_DB_SYNC_BYTES = 32 * 1024 * 1024;

/** Cache CDN — paths são imutáveis (uuid por arquivo). */
export const STORAGE_CACHE_CONTROL = "31536000";

export const UPLOAD_FILE_CONCURRENCY = {
  economy: readPositiveInt(process.env.UPLOAD_CONCURRENCY_ECONOMY, 4),
  normal: readPositiveInt(process.env.UPLOAD_CONCURRENCY_NORMAL, 12),
  turbo: readPositiveInt(process.env.UPLOAD_CONCURRENCY_TURBO, 24),
} as const;

export type UploadConcurrencyConfig = typeof UPLOAD_FILE_CONCURRENCY;

export function getSpeedPresets(concurrency: UploadConcurrencyConfig = UPLOAD_FILE_CONCURRENCY) {
  return {
    economy: {
      label: "Econômico",
      fileConcurrency: concurrency.economy,
      description: `${concurrency.economy} vídeos simultâneos`,
    },
    normal: {
      label: "Normal",
      fileConcurrency: concurrency.normal,
      description: `${concurrency.normal} vídeos simultâneos`,
    },
    turbo: {
      label: "Turbo",
      fileConcurrency: concurrency.turbo,
      description: `${concurrency.turbo} vídeos simultâneos`,
    },
  } as const;
}

export function formatMaxUploadSize() {
  if (MAX_UPLOAD_MB >= 1024) {
    const gb = MAX_UPLOAD_MB / 1024;
    return Number.isInteger(gb) ? `${gb} GB` : `${gb.toFixed(1)} GB`;
  }
  return `${MAX_UPLOAD_MB} MB`;
}

export function formatMaxUploadSizeShort() {
  return formatMaxUploadSize().replace(" ", "");
}

export function formatBucketLimitMb(bytes: number | null | undefined) {
  if (!bytes || bytes <= 0) return null;
  const mb = Math.floor(bytes / (1024 * 1024));
  if (mb >= 1024) {
    const gb = mb / 1024;
    return Number.isInteger(gb) ? `${gb} GB` : `${gb.toFixed(1)} GB`;
  }
  return `${mb} MB`;
}
