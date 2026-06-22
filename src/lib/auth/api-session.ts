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

export function sessionFailureResponse(result: SessionAuthResult, route: string) {
  if (result.ok) {
    throw new Error("sessionFailureResponse called with ok result");
  }

  if (result.reason === "db_timeout") {
    console.error("[auth-required-timeout]", { route, reason: result.reason, hasCookie: true });
    return authTimeoutJsonResponse(result.message);
  }

  if (result.reason === "db_error") {
    console.error("[auth-required-failed]", { route, reason: result.reason, hasCookie: true });
    return authDbErrorJsonResponse(result.message);
  }

  console.error("[auth-required-failed]", {
    route,
    reason: result.reason,
    hasCookie: result.reason !== "missing_cookie",
  });
  return unauthorizedJsonResponse(
    result.reason === "missing_cookie" ? "Não autenticado" : (result.message ?? "Não autenticado"),
  );
}

export async function resolveRequestSession(route: string): Promise<SessionAuthResult> {
  const headersList = await headers();
  const fromMiddleware = headersList.get(USER_ID_HEADER);
  if (fromMiddleware) {
    return { ok: true, userId: fromMiddleware, source: "cache" };
  }

  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
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
