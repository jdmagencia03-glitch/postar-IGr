import type { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseSignedSession } from "@/lib/auth/session-crypto";
import {
  SESSION_COOKIE,
  createOpaqueSessionToken,
  createSignedSession,
  getSessionCookieOptions,
  primeSessionCache,
} from "@/lib/auth/session";
import { API_SESSION_SAFE_TIMEOUT_MS } from "@/lib/auth/api-session";
import {
  resolveSessionFromToken,
  type SessionAuthResult,
} from "@/lib/auth/session-lookup";
import { withHardTimeout, DB_ROUTE_TIMEOUT_MS } from "@/lib/with-timeout";

/** Sessão assinada imediata — login não depende do Supabase responder. */
export function resolveOAuthCallbackSessionTokenFast(
  request: NextRequest,
  ownerId: string,
): string {
  const existing = request.cookies.get(SESSION_COOKIE)?.value;
  if (existing) {
    const signedUserId = parseSignedSession(existing);
    if (signedUserId === ownerId) return existing;
  }
  return createSignedSession(ownerId);
}

export function attachOAuthSessionCookie(
  response: NextResponse,
  ownerId: string,
  sessionToken: string,
) {
  primeSessionCache(sessionToken, ownerId);
  response.cookies.set(SESSION_COOKIE, sessionToken, getSessionCookieOptions());
}

export async function resolveOAuthCallbackSessionToken(
  request: NextRequest,
  ownerId: string,
  label: string,
): Promise<string> {
  const sessionToken = request.cookies.get(SESSION_COOKIE)?.value;
  if (!sessionToken) return createOpaqueSessionToken();

  const session = await withHardTimeout<SessionAuthResult>(
    resolveSessionFromToken(sessionToken, { route: label }),
    Math.min(API_SESSION_SAFE_TIMEOUT_MS, 4_000),
    { ok: false, reason: "db_timeout" },
    `${label}-session-token`,
  );

  if (session.ok && session.userId === ownerId) {
    return sessionToken;
  }

  return createOpaqueSessionToken();
}

export async function upsertAppSessionRow(
  supabase: SupabaseClient,
  params: {
    ownerId: string;
    sessionToken: string;
    encryptedAccessToken: string;
    label: string;
  },
): Promise<boolean> {
  const ok = await withHardTimeout(
    (async () => {
      const { error } = await supabase.from("app_sessions").upsert(
        {
          user_id: params.ownerId,
          session_token: params.sessionToken,
          access_token: params.encryptedAccessToken,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      );
      return !error;
    })(),
    DB_ROUTE_TIMEOUT_MS,
    false,
    params.label,
  );

  if (ok) {
    primeSessionCache(params.sessionToken, params.ownerId);
  }

  return ok;
}
