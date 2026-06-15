import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/meta/oauth";
import { createAdminClient } from "@/lib/supabase/admin";

async function handleLogout(request: NextRequest) {
  const sessionToken = request.cookies.get(SESSION_COOKIE)?.value;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  if (sessionToken && !/^\d+$/.test(sessionToken)) {
    const supabase = createAdminClient();
    await supabase
      .from("app_sessions")
      .update({ session_token: null })
      .eq("session_token", sessionToken);
  }

  const response = NextResponse.redirect(`${appUrl}/login`);
  response.cookies.delete(SESSION_COOKIE);
  return response;
}

export async function GET(request: NextRequest) {
  return handleLogout(request);
}

export async function POST(request: NextRequest) {
  return handleLogout(request);
}
