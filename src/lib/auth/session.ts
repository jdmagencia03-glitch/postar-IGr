import { cookies, headers } from "next/headers";
import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import {
  SESSION_COOKIE,
  USER_ID_HEADER,
  lookupSessionToken,
} from "@/lib/auth/session-core";

function getSessionSecret() {
  return (
    process.env.SESSION_SECRET ||
    process.env.CRON_SECRET ||
    "insta-scheduler-session-secret"
  );
}

export {
  SESSION_COOKIE,
  USER_ID_HEADER,
  getSessionCookieOptions,
  getSessionCookieDeleteOptions,
  lookupSessionToken,
} from "@/lib/auth/session-core";

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

export function parseSignedSession(value: string): string | null {
  const lastDot = value.lastIndexOf(".");
  if (lastDot <= 0) return null;

  const userId = value.slice(0, lastDot);
  const signature = value.slice(lastDot + 1);
  if (!userId || !signature) return null;

  const expected = createHmac("sha256", getSessionSecret())
    .update(userId)
    .digest("hex")
    .slice(0, 24);

  try {
    if (
      signature.length === expected.length &&
      timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
    ) {
      return userId;
    }
  } catch {
    return null;
  }

  return null;
}

export async function resolveSessionToken(token: string | undefined): Promise<string | null> {
  if (!token) return null;

  if (/^[a-f0-9]{64}$/i.test(token)) {
    const userId = await lookupSessionToken(token);
    if (userId) return userId;
  }

  const signedUserId = parseSignedSession(token);
  if (signedUserId) return signedUserId;

  if (/^\d+$/.test(token)) return token;

  return null;
}

export async function getSessionUserId(): Promise<string | null> {
  const headersList = await headers();
  const fromMiddleware = headersList.get(USER_ID_HEADER);
  if (fromMiddleware) return fromMiddleware;

  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  return resolveSessionToken(token);
}

export async function requireSessionUserId(): Promise<string> {
  const userId = await getSessionUserId();
  if (!userId) {
    throw new Error("UNAUTHORIZED");
  }
  return userId;
}
