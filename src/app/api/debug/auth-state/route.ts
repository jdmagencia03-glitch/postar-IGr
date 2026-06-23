import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/lib/auth/session-core";
import {
  requireApiSessionSafe,
  type ApiSessionResult,
} from "@/lib/auth/api-session";

export const dynamic = "force-dynamic";

type DebugSessionLookup =
  | "success"
  | "missing_cookie"
  | "invalid_session"
  | "expired_session"
  | "auth_timeout"
  | "auth_db_error";

function toDebugLookup(session: ApiSessionResult): {
  sessionLookup: DebugSessionLookup;
  source: "db" | "cache" | "none";
} {
  if (session.ok) {
    return { sessionLookup: "success", source: session.source };
  }

  if (session.reason === "auth_timeout") {
    return { sessionLookup: "auth_timeout", source: "none" };
  }

  if (session.reason === "auth_db_error") {
    return { sessionLookup: "auth_db_error", source: "none" };
  }

  return { sessionLookup: session.reason, source: "none" };
}

/** Diagnóstico leve de auth — sem userId, token ou email. */
export async function GET() {
  const startedAt = Date.now();
  const route = "/api/debug/auth-state";

  try {
    const cookieStore = await cookies();
    const hasSessionCookie = Boolean(cookieStore.get(SESSION_COOKIE)?.value);

    if (!hasSessionCookie) {
      return NextResponse.json(
        {
          ok: true,
          hasSessionCookie: false,
          sessionLookup: "missing_cookie" as const,
          durationMs: Date.now() - startedAt,
          source: "none" as const,
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    const session = await requireApiSessionSafe(route);
    const { sessionLookup, source } = toDebugLookup(session);

    return NextResponse.json(
      {
        ok: true,
        hasSessionCookie,
        sessionLookup,
        durationMs: Date.now() - startedAt,
        source,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[api-handler-failed]", { route, error });
    return NextResponse.json(
      {
        ok: true,
        hasSessionCookie: false,
        sessionLookup: "auth_db_error" as const,
        durationMs: Date.now() - startedAt,
        source: "none" as const,
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
