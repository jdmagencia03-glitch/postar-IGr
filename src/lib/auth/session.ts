import { cookies, headers } from "next/headers";
import { createHmac, randomBytes } from "crypto";
import { parseSignedSession } from "@/lib/auth/session-crypto";
import {
  SESSION_COOKIE,
  USER_ID_HEADER,
  lookupSessionToken,
} from "@/lib/auth/session-core";
import { getSessionSecret } from "@/lib/security/secrets";

export { parseSignedSession } from "@/lib/auth/session-crypto";
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

export async function resolveSessionToken(token: string | undefined): Promise<string | null> {
  if (!token) return null;

  if (/^[a-f0-9]{64}$/i.test(token)) {
    const userId = await lookupSessionToken(token);
    if (userId) return userId;
  }

  return parseSignedSession(token);
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
