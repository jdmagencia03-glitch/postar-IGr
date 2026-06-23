import { randomUUID } from "crypto";
import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { API_SESSION_SAFE_TIMEOUT_MS } from "@/lib/auth/api-session";
import {
  resolveSessionFromToken,
  type SessionAuthResult,
} from "@/lib/auth/session-lookup";
import { withHardTimeout, DB_ROUTE_TIMEOUT_MS } from "@/lib/with-timeout";

export type OAuthOwnerResolveResult =
  | { ownerId: string }
  | { error: "session_required" }
  | { error: "auth_timeout" }
  | { error: "auth_db_error" };

export async function resolveOAuthOwnerId(
  request: NextRequest,
  supabase: SupabaseClient,
  options: {
    requireExistingSession?: boolean;
    findExistingOwnerId: () => Promise<string | null | undefined>;
  },
): Promise<OAuthOwnerResolveResult> {
  const existingOwnerId = await withHardTimeout(
    options.findExistingOwnerId(),
    DB_ROUTE_TIMEOUT_MS,
    null,
    "resolveOAuthOwnerId/findExisting",
  );

  if (existingOwnerId) {
    return { ownerId: existingOwnerId };
  }

  const sessionToken = request.cookies.get(SESSION_COOKIE)?.value;
  if (sessionToken) {
    const session = await withHardTimeout<SessionAuthResult>(
      resolveSessionFromToken(sessionToken, {
        route: "resolveOAuthOwnerId",
      }),
      Math.min(API_SESSION_SAFE_TIMEOUT_MS, 4_000),
      { ok: false, reason: "db_timeout" },
      "resolveOAuthOwnerId/session",
    );

    if (session.ok) {
      return { ownerId: session.userId };
    }

    if (session.reason === "db_timeout" || session.reason === "db_error") {
      if (options.requireExistingSession) {
        return {
          error: session.reason === "db_timeout" ? "auth_timeout" : "auth_db_error",
        };
      }
      console.warn("[oauth-owner-session-skip]", { reason: session.reason });
    }
  }

  if (options.requireExistingSession) {
    return { error: "session_required" };
  }

  return { ownerId: randomUUID() };
}

export function readOAuthAddAccountFlag(request: NextRequest) {
  return request.cookies.get("oauth_add_account")?.value === "1";
}
