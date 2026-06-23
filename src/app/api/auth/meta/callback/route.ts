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
  primeSessionCache,
  resolveSessionFromToken,
} from "@/lib/auth/session";
import { validateOAuthCallbackState } from "@/lib/auth/oauth-state";
import {
  readOAuthAddAccountFlag,
  resolveOAuthOwnerId,
} from "@/lib/auth/resolve-owner";
import { createAdminClient } from "@/lib/supabase/admin";
import { logSecurityEvent } from "@/lib/security/audit";
import { getClientIp } from "@/lib/security/rate-limit";
import {
  encryptPageAccessToken,
  encryptSessionAccessToken,
} from "@/lib/security/tokens";

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

function isProfessionalInstagramAccount(accountType?: string) {
  const normalized = accountType?.toUpperCase() ?? "";
  return normalized === "BUSINESS" || normalized === "MEDIA_CREATOR";
}

async function validateAndConsumeOAuthState(
  state: string,
  cookieState: string | undefined,
  cookieNextPath: string | undefined,
  defaultNextPath: string,
) {
  return validateOAuthCallbackState({
    state,
    cookieState,
    cookieNextPath,
    defaultNextPath,
    label: "oauth-meta-callback",
  });
}

async function resolveSessionToken(request: NextRequest, ownerId: string) {
  const sessionToken = request.cookies.get(SESSION_COOKIE)?.value;

  if (sessionToken) {
    const session = await resolveSessionFromToken(sessionToken, {
      route: "meta/callback/resolveSessionToken",
    });
    if (session.ok && session.userId === ownerId) {
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
  const addAccount = readOAuthAddAccountFlag(request);

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
    response.cookies.set("oauth_add_account", "", getSessionCookieDeleteOptions());
    return response;
  }

  if (!code || !state) {
    return redirectWithError(appUrl, fallbackNext, "oauth_invalid");
  }

  const oauthState = await validateAndConsumeOAuthState(
    state,
    storedState,
    storedNext,
    fallbackNext,
  );
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

    if (!isProfessionalInstagramAccount(profile.account_type)) {
      return redirectWithError(appUrl, nextPath, "no_instagram");
    }

    const supabase = createAdminClient();
    const ownerResult = await resolveOAuthOwnerId(request, supabase, {
      requireExistingSession: addAccount,
      findExistingOwnerId: async () => {
        const { data: existingByIg } = await supabase
          .from("instagram_accounts")
          .select("owner_id, user_id")
          .eq("ig_user_id", profile.id)
          .maybeSingle();

        return existingByIg?.owner_id ?? existingByIg?.user_id ?? null;
      },
    });

    if ("error" in ownerResult) {
      if (ownerResult.error === "auth_timeout" || ownerResult.error === "auth_db_error") {
        return redirectWithError(
          appUrl,
          nextPath,
          ownerResult.error === "auth_timeout"
            ? "Não foi possível validar sua sessão agora. Tente novamente em instantes."
            : "Erro temporário ao validar sessão. Tente novamente em instantes.",
        );
      }
      return redirectWithError(
        appUrl,
        "/login",
        "Faça login antes de adicionar outra conta Instagram.",
      );
    }

    const ownerId = ownerResult.ownerId;
    const sessionToken = await resolveSessionToken(request, ownerId);

    await supabase.from("app_sessions").upsert(
      {
        user_id: ownerId,
        session_token: sessionToken,
        access_token: encryptSessionAccessToken(longToken),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );
    primeSessionCache(sessionToken, ownerId);

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
    response.cookies.set("oauth_add_account", "", getSessionCookieDeleteOptions());

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
