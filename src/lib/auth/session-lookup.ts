import { createHash } from "crypto";
import { parseSignedSession } from "@/lib/auth/session-crypto";

export const SESSION_LOOKUP_TIMEOUT_MS = 8_000;
const CACHE_TTL_MS = 5 * 60 * 1000;
const STALE_TTL_MS = 10 * 60 * 1000;

type CacheEntry = { userId: string; fetchedAt: number };

const sessionCache = new Map<string, CacheEntry>();

export type SessionLookupResult =
  | { ok: true; userId: string; source: "db" | "cache" }
  | {
      ok: false;
      reason:
        | "missing_cookie"
        | "invalid_session"
        | "expired_session"
        | "db_timeout"
        | "db_error";
      message?: string;
    };

export type SessionAuthResult = SessionLookupResult;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function primeSessionCache(token: string, userId: string) {
  sessionCache.set(hashToken(token), { userId, fetchedAt: Date.now() });
}

function readFreshCache(token: string): CacheEntry | null {
  const entry = sessionCache.get(hashToken(token));
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > STALE_TTL_MS) {
    sessionCache.delete(hashToken(token));
    return null;
  }
  return entry;
}

async function fetchSessionUserIdFromDb(token: string, route?: string): Promise<{
  userId: string | null;
  timedOut: boolean;
  errored: boolean;
  durationMs: number;
}> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const started = Date.now();

  if (!url || !key) {
    console.error("[session-lookup-db-error]", {
      route,
      durationMs: 0,
      reason: "missing_env",
      hasCookie: true,
    });
    return { userId: null, timedOut: false, errored: true, durationMs: 0 };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SESSION_LOOKUP_TIMEOUT_MS);

  try {
    const res = await fetch(
      `${url}/rest/v1/app_sessions?session_token=eq.${encodeURIComponent(token)}&select=user_id&limit=1`,
      {
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
        },
        cache: "no-store",
        signal: controller.signal,
      },
    );

    const durationMs = Date.now() - started;

    if (!res.ok) {
      console.error("[session-lookup-db-error]", {
        route,
        durationMs,
        reason: "http_error",
        status: res.status,
        hasCookie: true,
      });
      return { userId: null, timedOut: false, errored: true, durationMs };
    }

    const data = (await res.json()) as Array<{ user_id: string }>;
    return { userId: data[0]?.user_id ?? null, timedOut: false, errored: false, durationMs };
  } catch (error) {
    const durationMs = Date.now() - started;
    const isTimeout =
      error instanceof Error &&
      (error.name === "AbortError" || error.message.toLowerCase().includes("abort"));

    if (isTimeout) {
      console.error("[session-lookup-timeout]", {
        route,
        durationMs,
        reason: "db_timeout",
        hasCookie: true,
      });
      return { userId: null, timedOut: true, errored: false, durationMs };
    }

    console.error("[session-lookup-db-error]", {
      route,
      durationMs,
      reason: error instanceof Error ? error.name : "unknown",
      hasCookie: true,
    });
    return { userId: null, timedOut: false, errored: true, durationMs };
  } finally {
    clearTimeout(timer);
  }
}

export async function lookupOpaqueSessionToken(
  token: string,
  options?: { route?: string },
): Promise<SessionLookupResult> {
  const route = options?.route;
  const lookupStarted = Date.now();
  console.info("[session-lookup-start]", { route, hasCookie: true });

  const cached = readFreshCache(token);
  const now = Date.now();

  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
    console.info("[session-lookup-success]", {
      route,
      source: "cache",
      durationMs: Date.now() - lookupStarted,
      hasCookie: true,
    });
    return { ok: true, userId: cached.userId, source: "cache" };
  }

  const db = await fetchSessionUserIdFromDb(token, route);

  if (db.userId) {
    primeSessionCache(token, db.userId);
    console.info("[session-lookup-success]", {
      route,
      source: "db",
      durationMs: Date.now() - lookupStarted,
      hasCookie: true,
    });
    return { ok: true, userId: db.userId, source: "db" };
  }

  if (!db.timedOut && !db.errored) {
    sessionCache.delete(hashToken(token));
    return {
      ok: false,
      reason: "expired_session",
      message: "Sessão expirada ou inválida",
    };
  }

  if (cached) {
    console.info("[session-lookup-stale-cache]", {
      route,
      durationMs: db.durationMs,
      hasCookie: true,
    });
    return { ok: true, userId: cached.userId, source: "cache" };
  }

  if (db.timedOut) {
    console.error("[session-lookup-timeout]", {
      route,
      durationMs: db.durationMs,
      reason: "db_timeout",
      hasCookie: true,
    });
    return {
      ok: false,
      reason: "db_timeout",
      message: "Não foi possível validar sua sessão agora. Tente novamente em instantes.",
    };
  }

  return {
    ok: false,
    reason: "db_error",
    message: "Erro temporário ao validar sessão.",
  };
}
export async function lookupSessionToken(
  token: string,
  options?: { route?: string },
): Promise<string | null> {
  const result = await lookupOpaqueSessionToken(token, options);
  return result.ok ? result.userId : null;
}

export async function resolveSessionFromToken(
  token: string | undefined,
  options?: { route?: string },
): Promise<SessionAuthResult> {
  if (!token) {
    return { ok: false, reason: "missing_cookie" };
  }

  if (/^[a-f0-9]{64}$/i.test(token)) {
    return lookupOpaqueSessionToken(token, options);
  }

  const userId = parseSignedSession(token);
  if (userId) {
    return { ok: true, userId, source: "cache" };
  }

  return { ok: false, reason: "invalid_session", message: "Sessão inválida" };
}

export function isSessionUnavailable(
  result: SessionAuthResult,
): result is Extract<SessionAuthResult, { ok: false; reason: "db_timeout" | "db_error" }> {
  return !result.ok && (result.reason === "db_timeout" || result.reason === "db_error");
}

export function isSessionUnauthorized(
  result: SessionAuthResult,
): result is Extract<
  SessionAuthResult,
  { ok: false; reason: "missing_cookie" | "invalid_session" | "expired_session" }
> {
  return (
    !result.ok &&
    (result.reason === "missing_cookie" ||
      result.reason === "invalid_session" ||
      result.reason === "expired_session")
  );
}
