import { NextRequest, NextResponse } from "next/server";
import { getAppUrl } from "@/lib/app-url";
import { getSessionCookieDeleteOptions } from "@/lib/auth/session";
import { logSecurityEvent } from "@/lib/security/audit";
import { getClientIp } from "@/lib/security/rate-limit";

export const maxDuration = 10;

function sanitizeNextPath(value: string | null | undefined) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/dashboard";
  }
  return value;
}

function loginErrorRedirect(appUrl: string, message: string) {
  const url = `${appUrl}/login?${new URLSearchParams({ error: message }).toString()}`;
  const response = NextResponse.redirect(url, 302);
  response.cookies.set("meta_oauth_state", "", getSessionCookieDeleteOptions());
  response.cookies.set("meta_oauth_next", "", getSessionCookieDeleteOptions());
  response.cookies.set("oauth_add_account", "", getSessionCookieDeleteOptions());
  return response;
}

/** GET instantâneo: valida state/cookie e redireciona para a página de conclusão. */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const oauthError = searchParams.get("error_description") ?? searchParams.get("error");
  const storedState = request.cookies.get("meta_oauth_state")?.value;
  const storedNext = request.cookies.get("meta_oauth_next")?.value;
  const appUrl = getAppUrl();

  if (oauthError && !code) {
    void logSecurityEvent({
      eventType: "login_failed",
      ipAddress: getClientIp(request),
      userAgent: request.headers.get("user-agent"),
      metadata: { provider: "instagram", reason: oauthError },
    });
    return loginErrorRedirect(appUrl, oauthError);
  }

  if (!code || !state) {
    return loginErrorRedirect(appUrl, "oauth_invalid");
  }

  if (storedState && storedState !== state) {
    void logSecurityEvent({
      eventType: "login_failed",
      ipAddress: getClientIp(request),
      userAgent: request.headers.get("user-agent"),
      metadata: { provider: "instagram", reason: "oauth_invalid" },
    });
    return loginErrorRedirect(appUrl, "oauth_invalid");
  }

  if (!storedState) {
    const stateLooksValid = /^[a-f0-9]{32}$/i.test(state);
    if (!stateLooksValid) {
      void logSecurityEvent({
        eventType: "login_failed",
        ipAddress: getClientIp(request),
        userAgent: request.headers.get("user-agent"),
        metadata: { provider: "instagram", reason: "oauth_cookie_missing" },
      });
      return loginErrorRedirect(
        appUrl,
        "Sessão OAuth expirou. Use o mesmo navegador e permita cookies.",
      );
    }
    console.warn("[oauth-callback-cookieless-fallback]");
  }

  const finishUrl = new URL(`${appUrl}/api/auth/meta/finish`);
  finishUrl.searchParams.set("code", code);
  finishUrl.searchParams.set("state", state);
  finishUrl.searchParams.set("next", sanitizeNextPath(storedNext));

  return NextResponse.redirect(finishUrl.toString(), 302);
}
