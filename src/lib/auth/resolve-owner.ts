import { randomUUID } from "crypto";
import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { resolveSessionFromToken } from "@/lib/auth/session-lookup";

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
  const existingOwnerId = await options.findExistingOwnerId();
  if (existingOwnerId) {
    return { ownerId: existingOwnerId };
  }

  const sessionToken = request.cookies.get(SESSION_COOKIE)?.value;
  if (sessionToken) {
    const session = await resolveSessionFromToken(sessionToken, {
      route: "resolveOAuthOwnerId",
    });
    if (session.ok) {
      return { ownerId: session.userId };
    }
    if (session.reason === "db_timeout") {
      return { error: "auth_timeout" };
    }
    if (session.reason === "db_error") {
      return { error: "auth_db_error" };
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
