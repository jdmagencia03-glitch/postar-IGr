import { NextRequest, NextResponse } from "next/server";
import {
  discoverInstagramAccountsFromFacebook,
  exchangeFacebookCode,
  getLongLivedFacebookToken,
} from "@/lib/meta/facebook-oauth";
import { getOAuthStateCookieOptions } from "@/lib/meta/oauth";
import { getAppUrl } from "@/lib/app-url";
import {
  SESSION_COOKIE,
  createOpaqueSessionToken,
  getSessionCookieDeleteOptions,
  getSessionCookieOptions,
  lookupSessionToken,
} from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { randomUUID } from "crypto";

function sanitizeNextPath(value: string | null | undefined) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/dashboard/accounts";
  }
  return value;
}

function redirectWithError(appUrl: string, nextPath: string, message: string) {
  const params = new URLSearchParams({ error: message });
  return NextResponse.redirect(`${appUrl}${nextPath}?${params.toString()}`);
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

async function resolveOwnerId(request: NextRequest, igUserId: string) {
  const sessionToken = request.cookies.get(SESSION_COOKIE)?.value;
  const supabase = createAdminClient();

  const { data: existingByIg } = await supabase
    .from("instagram_accounts")
    .select("owner_id, user_id")
    .eq("ig_user_id", igUserId)
    .maybeSingle();

  if (existingByIg?.owner_id) return existingByIg.owner_id;
  if (existingByIg?.user_id) return existingByIg.user_id;

  if (sessionToken) {
    const ownerFromSession = await lookupSessionToken(sessionToken);
    if (ownerFromSession) return ownerFromSession;
  }

  return randomUUID();
}

async function resolveSessionToken(request: NextRequest, ownerId: string) {
  const sessionToken = request.cookies.get(SESSION_COOKIE)?.value;

  if (sessionToken) {
    const ownerFromSession = await lookupSessionToken(sessionToken);
    if (ownerFromSession === ownerId) {
      return sessionToken;
    }
  }

  return createOpaqueSessionToken();
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const oauthError = searchParams.get("error_description") ?? searchParams.get("error");
  const storedState = request.cookies.get("meta_oauth_state")?.value;
  const storedNext = request.cookies.get("meta_oauth_next")?.value;
  const appUrl = getAppUrl();
  const fallbackNext = sanitizeNextPath(storedNext);

  if (oauthError && !code) {
    const response = redirectWithError(appUrl, fallbackNext, oauthError);
    response.cookies.set("meta_oauth_state", "", getSessionCookieDeleteOptions());
    response.cookies.set("meta_oauth_next", "", getSessionCookieDeleteOptions());
    return response;
  }

  if (!code || !state) {
    return redirectWithError(appUrl, fallbackNext, "oauth_invalid");
  }

  const oauthState = await validateAndConsumeOAuthState(state, storedState);
  if (!oauthState.valid) {
    return redirectWithError(appUrl, fallbackNext, "oauth_invalid");
  }

  const nextPath = sanitizeNextPath(storedNext ?? oauthState.nextPath);

  try {
    const shortToken = await exchangeFacebookCode(code);
    const longToken = await getLongLivedFacebookToken(shortToken);
    const discovered = await discoverInstagramAccountsFromFacebook(longToken);

    const primary = discovered[0];
    const ownerId = await resolveOwnerId(request, primary.ig_user_id);
    const sessionToken = await resolveSessionToken(request, ownerId);
    const supabase = createAdminClient();

    await supabase.from("app_sessions").upsert(
      {
        user_id: ownerId,
        session_token: sessionToken,
        access_token: primary.page_access_token,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );

    for (const account of discovered) {
      await supabase.from("instagram_accounts").upsert(
        {
          owner_id: ownerId,
          user_id: ownerId,
          ig_user_id: account.ig_user_id,
          ig_username: account.ig_username,
          page_id: account.page_id,
          page_access_token: account.page_access_token,
          profile_picture_url: account.profile_picture_url,
          auth_provider: "facebook",
          warmup_enabled: true,
          warmup_days: 5,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "ig_user_id" },
      );

      await supabase
        .from("instagram_accounts")
        .update({ warmup_started_at: new Date().toISOString() })
        .eq("ig_user_id", account.ig_user_id)
        .is("warmup_started_at", null);
    }

    const connected = discovered.length;
    const response = NextResponse.redirect(
      `${appUrl}${nextPath}?connected=${connected}`,
    );
    response.cookies.set(SESSION_COOKIE, sessionToken, getSessionCookieOptions());
    response.cookies.set("meta_oauth_state", "", getSessionCookieDeleteOptions());
    response.cookies.set("meta_oauth_next", "", getSessionCookieDeleteOptions());
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro desconhecido";
    return redirectWithError(appUrl, nextPath, message);
  }
}
