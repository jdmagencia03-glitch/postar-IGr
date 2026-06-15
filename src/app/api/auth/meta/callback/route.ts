import { NextRequest, NextResponse } from "next/server";
import {
  exchangeCodeForToken,
  createSessionToken,
  getInstagramProfile,
  getLongLivedToken,
  getSessionCookieOptions,
  SESSION_COOKIE,
} from "@/lib/meta/oauth";
import { createAdminClient } from "@/lib/supabase/admin";

async function isValidOAuthState(state: string, cookieState?: string) {
  if (cookieState && cookieState === state) {
    return true;
  }

  const supabase = createAdminClient();
  const { data } = await supabase
    .from("oauth_states")
    .select("state")
    .eq("state", state)
    .maybeSingle();

  if (!data) {
    return false;
  }

  await supabase.from("oauth_states").delete().eq("state", state);
  return true;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const storedState = request.cookies.get("meta_oauth_state")?.value;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3001";

  if (!code || !state || !(await isValidOAuthState(state, storedState))) {
    return NextResponse.redirect(`${appUrl}/login?error=oauth_invalid`);
  }

  try {
    const tokenData = await exchangeCodeForToken(code);
    const longToken = await getLongLivedToken(tokenData.access_token);
    const profile = await getInstagramProfile(longToken);
    const userId = profile.id;

    const supabase = createAdminClient();

    const sessionToken = createSessionToken();

    await supabase.from("app_sessions").upsert(
      {
        user_id: userId,
        session_token: sessionToken,
        access_token: longToken,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );

    await supabase.from("instagram_accounts").upsert(
      {
        user_id: userId,
        ig_user_id: profile.id,
        ig_username: profile.username,
        page_id: profile.id,
        page_access_token: longToken,
        profile_picture_url: profile.profile_picture_url ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "ig_user_id" },
    );

    const response = NextResponse.redirect(`${appUrl}/dashboard`);
    response.cookies.set(SESSION_COOKIE, sessionToken, getSessionCookieOptions());
    response.cookies.delete("meta_oauth_state");
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro desconhecido";
    return NextResponse.redirect(
      `${appUrl}/login?error=${encodeURIComponent(message)}`,
    );
  }
}
