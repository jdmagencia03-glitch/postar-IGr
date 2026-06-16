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
  lookupSessionToken,
} from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { logSecurityEvent } from "@/lib/security/audit";
import { getClientIp } from "@/lib/security/rate-limit";
import {
  encryptPageAccessToken,
  encryptSessionAccessToken,
} from "@/lib/security/tokens";
import { randomUUID } from "crypto";

function sanitizeNextPath(value: string | null | undefined) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/dashboard";
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

  const valid = Boolean(cookieState && cookieState === state && data);

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

  if (existingByIg?.owner_id) {
    return existingByIg.owner_id;
  }

  if (existingByIg?.user_id) {
    return existingByIg.user_id;
  }

  if (sessionToken) {
    const ownerFromSession = await lookupSessionToken(sessionToken);
    if (ownerFromSession) {
      return ownerFromSession;
    }
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
    await logSecurityEvent({
      eventType: "login_failed",
      ipAddress: getClientIp(request),
      userAgent: request.headers.get("user-agent"),
      metadata: { provider: "instagram", reason: oauthError },
    });
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
    await logSecurityEvent({
      eventType: "login_failed",
      ipAddress: getClientIp(request),
      userAgent: request.headers.get("user-agent"),
      metadata: { provider: "instagram", reason: "oauth_invalid" },
    });
    return redirectWithError(appUrl, fallbackNext, "oauth_invalid");
  }

  const nextPath = sanitizeNextPath(storedNext ?? oauthState.nextPath);

  try {
    const tokenData = await exchangeCodeForToken(code);
    const longToken = await getLongLivedToken(tokenData.access_token);
    const profile = await getInstagramProfile(longToken);
    const ownerId = await resolveOwnerId(request, profile.id);
    const sessionToken = await resolveSessionToken(request, ownerId);

    const supabase = createAdminClient();

    await supabase.from("app_sessions").upsert(
      {
        user_id: ownerId,
        session_token: sessionToken,
        access_token: encryptSessionAccessToken(longToken),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );

    await supabase.from("instagram_accounts").upsert(
      {
        owner_id: ownerId,
        user_id: ownerId,
        ig_user_id: profile.id,
        ig_username: profile.username,
        page_id: profile.id,
        page_access_token: encryptPageAccessToken(longToken),
        profile_picture_url: profile.profile_picture_url ?? null,
        auth_provider: "instagram",
        warmup_enabled: true,
        warmup_days: 5,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "ig_user_id" },
    );

    await supabase
      .from("instagram_accounts")
      .update({ warmup_started_at: new Date().toISOString() })
      .eq("ig_user_id", profile.id)
      .is("warmup_started_at", null);

    const response = NextResponse.redirect(`${appUrl}${nextPath}?connected=1`);
    response.cookies.set(SESSION_COOKIE, sessionToken, getSessionCookieOptions());
    response.cookies.set("meta_oauth_state", "", getSessionCookieDeleteOptions());
    response.cookies.set("meta_oauth_next", "", getSessionCookieDeleteOptions());

    await logSecurityEvent({
      ownerId,
      eventType: "login_success",
      ipAddress: getClientIp(request),
      userAgent: request.headers.get("user-agent"),
      metadata: { provider: "instagram", igUserId: profile.id },
    });

    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro desconhecido";
    return redirectWithError(appUrl, nextPath, message);
  }
}
