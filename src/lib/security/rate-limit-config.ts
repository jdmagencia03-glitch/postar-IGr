export type RateLimitPolicy = {
  scope: string;
  limit: number;
  windowMs: number;
  skip?: boolean;
};

const WINDOW_MS = 60_000;

function readPositiveInt(value: string | undefined, fallback: number) {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const RATE_LIMIT_DEFAULT = readPositiveInt(process.env.RATE_LIMIT_API_PER_MIN, 120);
export const RATE_LIMIT_UPLOAD = readPositiveInt(process.env.RATE_LIMIT_UPLOAD_PER_MIN, 600);
export const RATE_LIMIT_AUTH = readPositiveInt(process.env.RATE_LIMIT_AUTH_PER_MIN, 24);
export const RATE_LIMIT_AI = readPositiveInt(process.env.RATE_LIMIT_AI_PER_MIN, 30);
export const RATE_LIMIT_ADMIN = readPositiveInt(process.env.RATE_LIMIT_ADMIN_PER_MIN, 90);
export const RATE_LIMIT_WEBHOOK = readPositiveInt(process.env.RATE_LIMIT_WEBHOOK_PER_MIN, 300);

function isAuthorizedCron(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export function resolveRateLimitPolicy(pathname: string, method: string, request: Request): RateLimitPolicy {
  if (
    method === "PATCH" &&
    /\/api\/upload\/batches\/[^/]+\/files\/[^/]+$/.test(pathname)
  ) {
    return { scope: "upload-progress", limit: 0, windowMs: WINDOW_MS, skip: true };
  }

  if (pathname.startsWith("/api/cron/")) {
    return {
      scope: "cron",
      limit: 0,
      windowMs: WINDOW_MS,
      skip: isAuthorizedCron(request),
    };
  }

  if (pathname.startsWith("/api/inngest")) {
    return { scope: "inngest", limit: 600, windowMs: WINDOW_MS };
  }

  if (pathname.startsWith("/api/webhooks/")) {
    return { scope: "webhook", limit: RATE_LIMIT_WEBHOOK, windowMs: WINDOW_MS };
  }

  if (pathname.startsWith("/api/auth/")) {
    return { scope: "auth", limit: RATE_LIMIT_AUTH, windowMs: WINDOW_MS };
  }

  if (
    pathname.startsWith("/api/captions/") ||
    pathname.startsWith("/api/ai/") ||
    pathname.includes("/regenerate-captions")
  ) {
    return { scope: "ai", limit: RATE_LIMIT_AI, windowMs: WINDOW_MS };
  }

  if (pathname.startsWith("/api/admin/")) {
    return { scope: "admin", limit: RATE_LIMIT_ADMIN, windowMs: WINDOW_MS };
  }

  if (pathname.startsWith("/api/upload")) {
    return { scope: "upload", limit: RATE_LIMIT_UPLOAD, windowMs: WINDOW_MS };
  }

  return { scope: "api", limit: RATE_LIMIT_DEFAULT, windowMs: WINDOW_MS };
}
