import { NextRequest, NextResponse } from "next/server";
import { getAppUrl } from "@/lib/app-url";
import {
  SESSION_COOKIE,
  getSessionCookieDeleteOptions,
  lookupSessionToken,
  parseSignedSession,
} from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";

async function resolveUserId(token: string | undefined) {
  if (!token) return null;

  if (/^[a-f0-9]{64}$/i.test(token)) {
    return lookupSessionToken(token);
  }

  const signed = parseSignedSession(token);
  if (signed) return signed;

  if (/^\d+$/.test(token)) return token;
  return null;
}

async function handleLogout(request: NextRequest) {
  const sessionToken = request.cookies.get(SESSION_COOKIE)?.value;
  const appUrl = getAppUrl();
  const supabase = createAdminClient();
  const userId = await resolveUserId(sessionToken);

  if (userId) {
    await supabase
      .from("app_sessions")
      .update({ session_token: null, updated_at: new Date().toISOString() })
      .eq("user_id", userId);
  } else if (sessionToken) {
    await supabase
      .from("app_sessions")
      .update({ session_token: null, updated_at: new Date().toISOString() })
      .eq("session_token", sessionToken);
  }

  const response = NextResponse.redirect(`${appUrl}/login`);
  response.cookies.set(SESSION_COOKIE, "", getSessionCookieDeleteOptions());
  return response;
}

export async function GET(request: NextRequest) {
  return handleLogout(request);
}

export async function POST(request: NextRequest) {
  return handleLogout(request);
}
