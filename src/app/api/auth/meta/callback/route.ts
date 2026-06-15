import { NextRequest, NextResponse } from "next/server";
import {
  exchangeCodeForToken,
  getInstagramProfile,
  getLongLivedToken,
  getOAuthStateCookieOptions,
} from "@/lib/meta/oauth";
import { getAppUrl } from "@/lib/app-url";
import {
  SESSION_COOKIE,
  createOpaqueSessionToken,
  getSessionCookieDeleteOptions,
  getSessionCookieOptions,
} from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";

function sanitizeNextPath(value: string | null | undefined) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/dashboard";
  }
  return value;
}

async function validateAndConsumeOAuthState(state: string, cookieState?: string) {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("oauth_states")
    .select("next_path")
    .eq("state", state)
    .maybeSingle();

  const valid = Boolean((cookieState && cookieState === state) || data);

  if (data) {
    await supabase.from("oauth_states").delete().eq("state", state);
  }

  return {
    valid,
    nextPath: sanitizeNextPath(data?.next_path),
  };
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const storedState = request.cookies.get("meta_oauth_state")?.value;
  const storedNext = request.cookies.get("meta_oauth_next")?.value;
  const appUrl = getAppUrl();

  if (!code || !state) {
    return NextResponse.redirect(`${appUrl}/login?error=oauth_invalid`);
  }

  const oauthState = await validateAndConsumeOAuthState(state, storedState);
  if (!oauthState.valid) {
    return NextResponse.redirect(`${appUrl}/login?error=oauth_invalid`);
  }

  const nextPath = sanitizeNextPath(storedNext ?? oauthState.nextPath);

  try {
    const tokenData = await exchangeCodeForToken(code);
    const longToken = await getLongLivedToken(tokenData.access_token);
    const profile = await getInstagramProfile(longToken);
    const userId = profile.id;
    const sessionToken = createOpaqueSessionToken();

    const supabase = createAdminClient();

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

    const response = NextResponse.redirect(`${appUrl}${nextPath}`);
    response.cookies.set(SESSION_COOKIE, sessionToken, getSessionCookieOptions());
    response.cookies.set("meta_oauth_state", "", getSessionCookieDeleteOptions());
    response.cookies.set("meta_oauth_next", "", getSessionCookieDeleteOptions());
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro desconhecido";
    return NextResponse.redirect(
      `${appUrl}/login?error=${encodeURIComponent(message)}`,
    );
  }
}
