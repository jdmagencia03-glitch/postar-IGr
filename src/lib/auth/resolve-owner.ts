import { randomUUID } from "crypto";
import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SESSION_COOKIE, lookupSessionToken } from "@/lib/auth/session";

export async function resolveOAuthOwnerId(
  request: NextRequest,
  supabase: SupabaseClient,
  options: {
    requireExistingSession?: boolean;
    findExistingOwnerId: () => Promise<string | null | undefined>;
  },
): Promise<{ ownerId: string } | { error: "session_required" }> {
  const existingOwnerId = await options.findExistingOwnerId();
  if (existingOwnerId) {
    return { ownerId: existingOwnerId };
  }

  const sessionToken = request.cookies.get(SESSION_COOKIE)?.value;
  if (sessionToken) {
    const ownerFromSession = await lookupSessionToken(sessionToken);
    if (ownerFromSession) {
      return { ownerId: ownerFromSession };
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
