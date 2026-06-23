import { NextRequest, NextResponse } from "next/server";
import { getAppUrl } from "@/lib/app-url";
import { attachOAuthSessionCookie } from "@/lib/auth/oauth-callback-persist";
import { completeMetaOAuthExchange } from "@/lib/auth/meta-oauth-exchange";
import { getSessionCookieDeleteOptions } from "@/lib/auth/session";

export const maxDuration = 60;

function clearOAuthCookies(response: NextResponse) {
  response.cookies.set("meta_oauth_state", "", getSessionCookieDeleteOptions());
  response.cookies.set("meta_oauth_next", "", getSessionCookieDeleteOptions());
  response.cookies.set("oauth_add_account", "", getSessionCookieDeleteOptions());
}

function loginErrorRedirect(appUrl: string, message: string) {
  const url = `${appUrl}/login?${new URLSearchParams({ error: message }).toString()}`;
  const response = NextResponse.redirect(url, 302);
  clearOAuthCookies(response);
  return response;
}

/** Conclusão OAuth via navegação completa — cookies confiáveis no AdsPower (fetch não grava Set-Cookie). */
export async function GET(request: NextRequest) {
  const appUrl = getAppUrl();
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code")?.trim();
  const state = searchParams.get("state")?.trim();
  const nextPath = searchParams.get("next");

  if (!code || !state) {
    return loginErrorRedirect(appUrl, "Falha na autenticação. Tente novamente.");
  }

  const result = await completeMetaOAuthExchange(request, {
    code,
    state,
    nextPath,
  });

  if (!result.ok) {
    return loginErrorRedirect(appUrl, result.error);
  }

  const response = NextResponse.redirect(`${appUrl}${result.redirectTo}`, 302);
  attachOAuthSessionCookie(response, result.ownerId, result.sessionToken);
  clearOAuthCookies(response);
  return response;
}
