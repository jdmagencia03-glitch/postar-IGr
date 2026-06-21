/** Código normalizado para rate limit / action block do Instagram. */
export const INSTAGRAM_RATE_LIMIT_CODE = "instagram_rate_limit_or_action_block";

const RATE_LIMIT_PATTERNS = [
  /user is performing too many actions/i,
  /application request limit reached/i,
  /rate limit/i,
  /temporarily blocked/i,
  /too many calls/i,
  /too many requests/i,
  /(#803)/i,
  /qps/i,
  /quota exceeded/i,
  /429/,
];

export function isInstagramRateLimitError(message: string | null | undefined) {
  if (!message?.trim()) return false;
  if (message.includes(INSTAGRAM_RATE_LIMIT_CODE)) return true;
  return RATE_LIMIT_PATTERNS.some((pattern) => pattern.test(message));
}

/** Prefixa mensagem com código normalizado quando for rate limit. */
export function normalizeInstagramPublishError(message: string) {
  if (isInstagramRateLimitError(message)) {
    const stripped = message.replace(/^\[?\w[\w_]*\]?:?\s*/i, "").trim();
    return `${INSTAGRAM_RATE_LIMIT_CODE}: ${stripped}`;
  }
  return message;
}

export function isFalseDuplicateGuardMessage(message: string | null | undefined) {
  if (!message) return false;
  const lower = message.toLowerCase();
  return (
    lower.includes("log de sucesso existente") ||
    lower.includes("publicação anterior detectada nos logs") ||
    lower.includes("publicação detectada nos logs") ||
    lower.includes("republicação bloqueada")
  );
}
