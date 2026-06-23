import { NextResponse } from "next/server";
import { cookies, headers } from "next/headers";
import { SESSION_COOKIE, USER_ID_HEADER } from "@/lib/auth/session-core";
import {
  isSessionUnauthorized,
  isSessionUnavailable,
  resolveSessionFromToken,
  type SessionAuthResult,
} from "@/lib/auth/session-lookup";

const NO_STORE = { "Cache-Control": "no-store" };
export const API_SESSION_SAFE_TIMEOUT_MS = 5_000;

export type ApiSessionResult =
  | { ok: true; userId: string; source: "db" | "cache" }
  | {
      ok: false;
      reason:
        | "missing_cookie"
        | "invalid_session"
        | "expired_session"
        | "auth_timeout"
        | "auth_db_error";
      status: number;
      error: string;
      message: string;
    };

export function unauthorizedJsonResponse(message = "Não autenticado") {
  return NextResponse.json(
    { ok: false, error: "unauthorized", message },
    { status: 401, headers: NO_STORE },
  );
}

export function authTimeoutJsonResponse(message?: string) {
  return NextResponse.json(
    {
      ok: false,
      error: "auth_timeout",
      message:
        message ?? "Não foi possível validar sua sessão agora. Tente novamente em instantes.",
      data: [],
    },
    { status: 503, headers: NO_STORE },
  );
}

export function authDbErrorJsonResponse(message?: string) {
  return NextResponse.json(
    {
      ok: false,
      error: "auth_db_error",
      message: message ?? "Erro temporário ao validar sessão.",
      data: [],
    },
    { status: 503, headers: NO_STORE },
  );
}

function mapSessionFailure(session: Extract<SessionAuthResult, { ok: false }>): Extract<
  ApiSessionResult,
  { ok: false }
> {
  if (session.reason === "missing_cookie") {
    return {
      ok: false,
      reason: "missing_cookie",
      status: 401,
      error: "unauthorized",
      message: "Não autenticado",
    };
  }

  if (session.reason === "invalid_session" || session.reason === "expired_session") {
    return {
      ok: false,
      reason: session.reason,
      status: 401,
      error: "unauthorized",
      message: session.message ?? "Não autenticado",
    };
  }

  if (session.reason === "db_timeout") {
    return {
      ok: false,
      reason: "auth_timeout",
      status: 503,
      error: "auth_timeout",
      message:
        session.message ??
        "Não foi possível validar sua sessão agora. Tente novamente em instantes.",
    };
  }

  return {
    ok: false,
    reason: "auth_db_error",
    status: 503,
    error: "auth_db_error",
    message: session.message ?? "Erro temporário ao validar sessão.",
  };
}

export function apiSessionErrorResponse(
  session: Extract<ApiSessionResult, { ok: false }>,
  data: unknown = [],
) {
  if (
    session.reason === "missing_cookie" ||
    session.reason === "invalid_session" ||
    session.reason === "expired_session"
  ) {
    return unauthorizedJsonResponse(session.message);
  }

  return NextResponse.json(
    {
      ok: false,
      error: session.error,
      message: session.message,
      data,
    },
    { status: session.status, headers: NO_STORE },
  );
}

export function sessionFailureResponse(result: SessionAuthResult, route: string) {
  if (result.ok) {
    throw new Error("sessionFailureResponse called with ok result");
  }

  const mapped = mapSessionFailure(result);

  if (mapped.reason === "auth_timeout") {
    console.error("[auth-required-timeout]", { route, reason: mapped.reason, hasCookie: true });
    return authTimeoutJsonResponse(mapped.message);
  }

  if (mapped.reason === "auth_db_error") {
    console.error("[auth-required-failed]", { route, reason: mapped.reason, hasCookie: true });
    return authDbErrorJsonResponse(mapped.message);
  }

  console.error("[auth-required-failed]", {
    route,
    reason: mapped.reason,
    hasCookie: mapped.reason !== "missing_cookie",
  });
  return unauthorizedJsonResponse(mapped.message);
}

export async function resolveRequestSession(route: string): Promise<SessionAuthResult> {
  console.info("[auth-start]", { route });

  const headersList = await headers();
  const fromMiddleware = headersList.get(USER_ID_HEADER);
  if (fromMiddleware) {
    console.info("[session-lookup-success]", {
      route,
      source: "cache",
      durationMs: 0,
      hasCookie: true,
    });
    return { ok: true, userId: fromMiddleware, source: "cache" };
  }

  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  console.info("[auth-cookie-present]", { route, hasCookie: Boolean(token) });

  return resolveSessionFromToken(token, { route });
}

export async function requireApiSession(route: string): Promise<
  | { ok: true; userId: string }
  | { ok: false; response: NextResponse }
> {
  const session = await resolveRequestSession(route);

  if (session.ok) {
    return { ok: true, userId: session.userId };
  }

  if (isSessionUnavailable(session) || isSessionUnauthorized(session)) {
    return { ok: false, response: sessionFailureResponse(session, route) };
  }

  return { ok: false, response: unauthorizedJsonResponse() };
}

export async function requireApiSessionSafe(
  route: string,
  options?: { timeoutMs?: number },
): Promise<ApiSessionResult> {
  const timeoutMs = options?.timeoutMs ?? API_SESSION_SAFE_TIMEOUT_MS;
  const startedAt = Date.now();

  try {
    const result = await Promise.race<ApiSessionResult>([
      (async (): Promise<ApiSessionResult> => {
        const session = await resolveRequestSession(route);
        if (session.ok) {
          return { ok: true, userId: session.userId, source: session.source };
        }
        return mapSessionFailure(session);
      })(),
      new Promise<ApiSessionResult>((resolve) => {
        setTimeout(() => {
          console.error("[require-api-session-timeout]", {
            route,
            durationMs: Date.now() - startedAt,
          });
          resolve({
            ok: false,
            reason: "auth_timeout",
            status: 503,
            error: "auth_timeout",
            message:
              "Não foi possível validar sua sessão agora. Tente novamente em instantes.",
          });
        }, timeoutMs);
      }),
    ]);

    return result;
  } catch (error) {
    console.error("[require-api-session-failed]", {
      route,
      durationMs: Date.now() - startedAt,
      error,
    });

    return {
      ok: false,
      reason: "auth_db_error",
      status: 503,
      error: "auth_db_error",
      message: "Erro temporário ao validar sessão.",
    };
  }
}

/** Retorna userId autenticado ou null apenas para sessão ausente/inválida real. */
export async function getSessionUserIdSafe(route: string): Promise<string | null> {
  const session = await resolveRequestSession(route);
  if (session.ok) return session.userId;
  if (isSessionUnauthorized(session)) return null;
  return null;
}

export async function getSessionAuth(): Promise<SessionAuthResult> {
  return resolveRequestSession("getSessionAuth");
}
