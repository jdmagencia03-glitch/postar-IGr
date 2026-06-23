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

/** Vídeos por lote de upload (teto fixo em produção: 600). */
export const MAX_VIDEOS_PER_BATCH = readPositiveInt(process.env.MAX_VIDEOS_PER_BATCH, 600);

/** Metadados por requisição ao criar lote (payload Vercel). */
/** Metadados por POST ao criar lote — valores altos estouram timeout na Vercel. */
export const BATCH_CREATE_CHUNK_SIZE = readPositiveInt(process.env.UPLOAD_BATCH_CHUNK_SIZE, 200);

/** Linhas inseridas por vez no Postgres ao registrar arquivos. */
export const DB_INSERT_CHUNK_SIZE = readPositiveInt(process.env.UPLOAD_DB_CHUNK_SIZE, 500);

/** Supabase TUS exige mínimo de 6MB por chunk (não aumentar). */
export const TUS_CHUNK_SIZE = 6 * 1024 * 1024;

export const UPLOAD_PROGRESS_DB_SYNC_BYTES = 64 * 1024 * 1024;

/** Sem bytes novos neste intervalo → upload TUS considerado travado.
 *  Deve ser maior que o tempo de enviar 1 chunk (6MB) em conexão lenta (~50 KB/s ≈ 2 min). */
export const UPLOAD_STALL_TIMEOUT_MS = readPositiveInt(
  process.env.UPLOAD_STALL_TIMEOUT_MS,
  300_000,
);

/** Sem novo arquivo concluído neste intervalo → lote considerado travado. */
export const UPLOAD_BATCH_STALL_TIMEOUT_MS = readPositiveInt(
  process.env.UPLOAD_BATCH_STALL_TIMEOUT_MS,
  420_000,
);

/** Intervalo do watchdog global do lote (ms). */
export const UPLOAD_BATCH_WATCHDOG_INTERVAL_MS = readPositiveInt(
  process.env.UPLOAD_BATCH_WATCHDOG_INTERVAL_MS,
  30_000,
);

/** Percentual em que o TUS costuma pausar aguardando confirmação do servidor. */
export const UPLOAD_NEAR_COMPLETE_PERCENT = readPositiveInt(
  process.env.UPLOAD_NEAR_COMPLETE_PERCENT,
  96,
);

/** Sem avanço neste percentual → reconciliar / confirmar no servidor. */
export const UPLOAD_NEAR_COMPLETE_STALL_MS = readPositiveInt(
  process.env.UPLOAD_NEAR_COMPLETE_STALL_MS,
  75_000,
);

/** Timeout absoluto por arquivo (fallback para conexões zumbis). */
export const UPLOAD_FILE_TIMEOUT_MS = readPositiveInt(
  process.env.UPLOAD_FILE_TIMEOUT_MS,
  30 * 60_000,
);

/** Cache CDN — paths são imutáveis (uuid por arquivo). */
export const STORAGE_CACHE_CONTROL = "31536000";

/** Navegadores limitam ~6 conexões HTTP simultâneas por domínio. */
export const BROWSER_UPLOAD_CONCURRENCY_CAP = 6;

export const UPLOAD_FILE_CONCURRENCY = {
  economy: readPositiveInt(process.env.UPLOAD_CONCURRENCY_ECONOMY, 2),
  normal: readPositiveInt(process.env.UPLOAD_CONCURRENCY_NORMAL, 4),
  turbo: readPositiveInt(process.env.UPLOAD_CONCURRENCY_TURBO, 6),
} as const;

/** Concorrência base do modo adaptativo (ponto de partida antes de ajustes). */
export const ADAPTIVE_BASE_CONCURRENCY = UPLOAD_FILE_CONCURRENCY;

export type UploadConcurrencyConfig = typeof UPLOAD_FILE_CONCURRENCY;

/** Modos fixos de concorrência (adaptativo usa effective mode em runtime). */
export type UploadSpeedMode = keyof UploadConcurrencyConfig | "adaptive";

export type UploadSpeedPreset = {
  label: string;
  fileConcurrency: number;
  description: string;
};

export type UploadSpeedPresets = Record<Exclude<UploadSpeedMode, "adaptive">, UploadSpeedPreset> & {
  adaptive: UploadSpeedPreset;
};

export function clampUploadConcurrency(requested: number) {
  return Math.min(Math.max(1, requested), BROWSER_UPLOAD_CONCURRENCY_CAP);
}

/** Valores efetivos usados pelo motor de upload (respeitam o teto do navegador). */
export function getEffectiveUploadConcurrency(
  concurrency: UploadConcurrencyConfig = UPLOAD_FILE_CONCURRENCY,
): UploadConcurrencyConfig {
  return {
    economy: clampUploadConcurrency(concurrency.economy),
    normal: clampUploadConcurrency(concurrency.normal),
    turbo: clampUploadConcurrency(concurrency.turbo),
  };
}

export function getSpeedPresets(concurrency: UploadConcurrencyConfig = UPLOAD_FILE_CONCURRENCY): UploadSpeedPresets {
  const capNote =
    Math.max(concurrency.economy, concurrency.normal, concurrency.turbo) >
    BROWSER_UPLOAD_CONCURRENCY_CAP
      ? ` (máx. ${BROWSER_UPLOAD_CONCURRENCY_CAP} — limite do navegador)`
      : "";

  const fixed = {
    economy: {
      label: "Econômico",
      fileConcurrency: clampUploadConcurrency(concurrency.economy),
      description: `${clampUploadConcurrency(concurrency.economy)} vídeos simultâneos${capNote}`,
    },
    normal: {
      label: "Normal",
      fileConcurrency: clampUploadConcurrency(concurrency.normal),
      description: `${clampUploadConcurrency(concurrency.normal)} vídeos simultâneos${capNote}`,
    },
    turbo: {
      label: "Turbo",
      fileConcurrency: clampUploadConcurrency(concurrency.turbo),
      description: `${clampUploadConcurrency(concurrency.turbo)} vídeos simultâneos${capNote}`,
    },
  } as const;

  return {
    ...fixed,
    adaptive: {
      label: "Adaptativo",
      fileConcurrency: clampUploadConcurrency(concurrency.normal),
      description: `Ajusta automaticamente (2–${clampUploadConcurrency(concurrency.turbo)} simultâneos)${capNote}`,
    },
  };
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
