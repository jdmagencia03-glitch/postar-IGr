export const SESSION_COOKIE = "insta_scheduler_session";
export const USER_ID_HEADER = "x-user-id";

export function isProduction() {
  return process.env.NODE_ENV === "production" || Boolean(process.env.VERCEL);
}

export function getSessionCookieOptions() {
  return {
    httpOnly: true,
    secure: isProduction(),
    sameSite: "lax" as const,
    maxAge: 60 * 60 * 24 * 60,
    path: "/",
  };
}

export function getSessionCookieDeleteOptions() {
  return {
    httpOnly: true,
    secure: isProduction(),
    sameSite: "lax" as const,
    maxAge: 0,
    path: "/",
  };
}

export {
  lookupSessionToken,
  lookupOpaqueSessionToken,
  resolveSessionFromToken,
  primeSessionCache,
  isSessionUnavailable,
  isSessionUnauthorized,
  SESSION_LOOKUP_TIMEOUT_MS,
  type SessionAuthResult,
  type SessionLookupResult,
} from "@/lib/auth/session-lookup";
