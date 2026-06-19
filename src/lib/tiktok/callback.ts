import { NextRequest, NextResponse } from "next/server";
import {
  exchangeCodeForToken,
  getOAuthStateCookieOptions,
  getTikTokProfile,
} from "@/lib/tiktok/oauth";
import { getAppUrl } from "@/lib/app-url";
import {
  readOAuthAddAccountFlag,
  resolveOAuthOwnerId,
} from "@/lib/auth/resolve-owner";
import {
  SESSION_COOKIE,
  createOpaqueSessionToken,
  getSessionCookieDeleteOptions,
  getSessionCookieOptions,
  lookupSessionToken,
} from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { logSecurityEvent } from "@/lib/security/audit";
import { getClientIp } from "@/lib/security/rate-limit";
import {
  encryptTikTokAccessToken,
  encryptTikTokRefreshToken,
} from "@/lib/security/tokens";

function sanitizeNextPath(value: string | null | undefined) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/dashboard/tiktok";
  }
  return value;
}

function redirectWithError(appUrl: string, nextPath: string, message: string) {
  const params = new URLSearchParams({ error: message, platform: "tiktok" });
  return NextResponse.redirect(`${appUrl}${nextPath}?${params.toString()}`);
}

async function validateAndConsumeOAuthState(state: string, cookieState?: string) {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("oauth_states")
    .select("next_path")
    .eq("state", state)
    .maybeSingle();

  const valid = Boolean(cookieState && cookieState === state && data);

  if (data) {
    await supabase.from("oauth_states").delete().eq("state", state);
  }

  return {
    valid,
    nextPath: sanitizeNextPath(data?.next_path),
  };
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

export async function handleTikTokOAuthCallback(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const oauthError = searchParams.get("error_description") ?? searchParams.get("error");
  const storedState = request.cookies.get("tiktok_oauth_state")?.value;
  const storedNext = request.cookies.get("tiktok_oauth_next")?.value;
  const appUrl = getAppUrl();
  const fallbackNext = sanitizeNextPath(storedNext);
  const addAccount = readOAuthAddAccountFlag(request);

  if (oauthError && !code) {
    await logSecurityEvent({
      eventType: "login_failed",
      ipAddress: getClientIp(request),
      userAgent: request.headers.get("user-agent"),
      metadata: { provider: "tiktok", reason: oauthError },
    });
    const response = redirectWithError(appUrl, fallbackNext, oauthError);
    response.cookies.set("tiktok_oauth_state", "", getSessionCookieDeleteOptions());
    response.cookies.set("tiktok_oauth_next", "", getSessionCookieDeleteOptions());
    response.cookies.set("oauth_add_account", "", getSessionCookieDeleteOptions());
    return response;
  }

  if (!code || !state) {
    return redirectWithError(appUrl, fallbackNext, "oauth_invalid");
  }

  const oauthState = await validateAndConsumeOAuthState(state, storedState);
  if (!oauthState.valid) {
    await logSecurityEvent({
      eventType: "login_failed",
      ipAddress: getClientIp(request),
      userAgent: request.headers.get("user-agent"),
      metadata: { provider: "tiktok", reason: "oauth_invalid" },
    });
    return redirectWithError(appUrl, fallbackNext, "oauth_invalid");
  }

  const nextPath = sanitizeNextPath(storedNext ?? oauthState.nextPath);

  try {
    const tokenData = await exchangeCodeForToken(code);
    const profile = await getTikTokProfile(tokenData.access_token);
    const supabase = createAdminClient();

    const ownerResult = await resolveOAuthOwnerId(request, supabase, {
      requireExistingSession: addAccount,
      findExistingOwnerId: async () => {
        const { data: existing } = await supabase
          .from("tiktok_accounts")
          .select("owner_id")
          .eq("open_id", profile.open_id)
          .maybeSingle();
        return existing?.owner_id ?? null;
      },
    });

    if ("error" in ownerResult) {
      return redirectWithError(
        appUrl,
        "/login",
        "Faça login antes de adicionar outra conta TikTok.",
      );
    }

    const ownerId = ownerResult.ownerId;
    const sessionToken = await resolveSessionToken(request, ownerId);

    const tokenExpiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();
    const refreshExpiresAt = new Date(
      Date.now() + tokenData.refresh_expires_in * 1000,
    ).toISOString();

    await supabase.from("app_sessions").upsert(
      {
        user_id: ownerId,
        session_token: sessionToken,
        access_token: encryptTikTokAccessToken(tokenData.access_token),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );

    await supabase.from("tiktok_accounts").upsert(
      {
        owner_id: ownerId,
        open_id: profile.open_id,
        username: profile.username,
        display_name: profile.display_name,
        profile_picture_url: profile.profile_picture_url,
        access_token: encryptTikTokAccessToken(tokenData.access_token),
        refresh_token: encryptTikTokRefreshToken(tokenData.refresh_token),
        token_expires_at: tokenExpiresAt,
        refresh_expires_at: refreshExpiresAt,
        scopes: tokenData.scope,
        status: "active",
        last_validation_error: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "open_id" },
    );

    const response = NextResponse.redirect(
      `${appUrl}${nextPath}?connected=1&platform=tiktok`,
    );
    response.cookies.set(SESSION_COOKIE, sessionToken, getSessionCookieOptions());
    response.cookies.set("tiktok_oauth_state", "", getSessionCookieDeleteOptions());
    response.cookies.set("tiktok_oauth_next", "", getSessionCookieDeleteOptions());
    response.cookies.set("oauth_add_account", "", getSessionCookieDeleteOptions());

    await logSecurityEvent({
      ownerId,
      eventType: "tiktok_connect",
      ipAddress: getClientIp(request),
      userAgent: request.headers.get("user-agent"),
      metadata: { openId: profile.open_id, username: profile.username },
    });

    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro desconhecido";
    return redirectWithError(appUrl, nextPath, message);
  }
}
