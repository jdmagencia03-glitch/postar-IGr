import { cookies, headers } from "next/headers";
import { createHmac, randomBytes } from "crypto";
import { parseSignedSession } from "@/lib/auth/session-crypto";
import {
  SESSION_COOKIE,
  USER_ID_HEADER,
  lookupSessionToken,
  primeSessionCache,
  resolveSessionFromToken,
} from "@/lib/auth/session-core";
import { getSessionSecret } from "@/lib/security/secrets";

export { parseSignedSession } from "@/lib/auth/session-crypto";
export {
  SESSION_COOKIE,
  USER_ID_HEADER,
  getSessionCookieOptions,
  getSessionCookieDeleteOptions,
  lookupSessionToken,
  lookupOpaqueSessionToken,
  resolveSessionFromToken,
  primeSessionCache,
  isSessionUnavailable,
  isSessionUnauthorized,
  SESSION_LOOKUP_TIMEOUT_MS,
  type SessionAuthResult,
  type SessionLookupResult,
} from "@/lib/auth/session-core";
export {
  requireApiSession,
  requireApiSessionSafe,
  resolveRequestSession,
  getSessionAuth,
  getSessionUserIdSafe,
  apiSessionErrorResponse,
  unauthorizedJsonResponse,
  authTimeoutJsonResponse,
  authDbErrorJsonResponse,
  API_SESSION_SAFE_TIMEOUT_MS,
  type ApiSessionResult,
} from "@/lib/auth/api-session";

export function createOpaqueSessionToken() {
  return randomBytes(32).toString("hex");
}

export function createSignedSession(userId: string) {
  const signature = createHmac("sha256", getSessionSecret())
    .update(userId)
    .digest("hex")
    .slice(0, 24);

  return `${userId}.${signature}`;
}

export async function resolveSessionToken(token: string | undefined): Promise<string | null> {
  const result = await resolveSessionFromToken(token, { route: "resolveSessionToken" });
  return result.ok ? result.userId : null;
}

export async function getSessionUserId(): Promise<string | null> {
  const headersList = await headers();
  const fromMiddleware = headersList.get(USER_ID_HEADER);
  if (fromMiddleware) return fromMiddleware;

  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const result = await resolveSessionFromToken(token, { route: "getSessionUserId" });
  return result.ok ? result.userId : null;
}

export async function requireSessionUserId(): Promise<string> {
  const userId = await getSessionUserId();
  if (!userId) {
    throw new Error("UNAUTHORIZED");
  }
  return userId;
}
