import { retryCooldownMs } from "@/lib/publish/retry-policy";
import { isInstagramRateLimitError } from "@/lib/instagram/errors";

export type PublishFailureKind =
  | "rate_limit"
  | "media_processing"
  | "media_timeout"
  | "interrupted"
  | "token"
  | "generic";

const RATE_LIMIT_COOLDOWN_MS = [6 * 60 * 60_000, 12 * 60 * 60_000] as const;
const MEDIA_COOLDOWN_MS = [10 * 60_000, 30 * 60_000, 60 * 60_000] as const;
const INTERRUPTED_COOLDOWN_MS = [5 * 60_000, 15 * 60_000, 30 * 60_000] as const;

export function classifyPublishFailureMessage(message: string): PublishFailureKind {
  const lower = message.toLowerCase();

  if (/url_ownership_unverified|video url ownership|domain.*not verified/i.test(lower)) {
    return "token";
  }
  if (isInstagramRateLimitError(lower)) {
    return "rate_limit";
  }
  if (/publicação interrompida|interrompida \(timeout\)/i.test(lower)) {
    return "interrupted";
  }
  if (/timeout aguardando processamento/i.test(lower)) {
    return "media_timeout";
  }
  if (/processamento da mídia falhou/i.test(lower)) {
    return "media_processing";
  }
  if (/token|expir|oauth|unauthorized|não autenticado/i.test(lower)) {
    return "token";
  }
  return "generic";
}

function pickCooldown(table: readonly number[], retryCount: number) {
  const index = Math.max(0, Math.min(retryCount - 1, table.length - 1));
  return table[index];
}

export function retryCooldownMsForFailure(message: string, retryCount: number) {
  const kind = classifyPublishFailureMessage(message);
  switch (kind) {
    case "rate_limit":
      return pickCooldown(RATE_LIMIT_COOLDOWN_MS, retryCount);
    case "media_timeout":
    case "media_processing":
      return pickCooldown(MEDIA_COOLDOWN_MS, retryCount);
    case "interrupted":
      return pickCooldown(INTERRUPTED_COOLDOWN_MS, retryCount);
    default:
      return retryCooldownMs(retryCount);
  }
}

export function nextRetryAtForFailure(message: string, retryCount: number, now = new Date()) {
  return new Date(now.getTime() + retryCooldownMsForFailure(message, retryCount)).toISOString();
}

/** Intervalo mínimo entre publicações bem-sucedidas na mesma conta Instagram. */
export const INSTAGRAM_PUBLISH_COOLDOWN_MS = 20 * 60_000;

/** Intervalo mínimo entre publicações bem-sucedidas na mesma conta TikTok. */
export const TIKTOK_PUBLISH_COOLDOWN_MS = 20 * 60_000;

/** Pausa automática da conta após rate limit (cron ignora até retomar manualmente). */
export const AUTO_PAUSE_ON_RATE_LIMIT_MS = 2 * 60 * 60_000;
