import { NextRequest, NextResponse } from "next/server";
import { attachOAuthSessionCookie } from "@/lib/auth/oauth-callback-persist";
import { completeMetaOAuthExchange } from "@/lib/auth/meta-oauth-exchange";
import { getSessionCookieDeleteOptions } from "@/lib/auth/session";

export const maxDuration = 30;

function clearOAuthCookies(response: NextResponse) {
  response.cookies.set("meta_oauth_state", "", getSessionCookieDeleteOptions());
  response.cookies.set("meta_oauth_next", "", getSessionCookieDeleteOptions());
  response.cookies.set("oauth_add_account", "", getSessionCookieDeleteOptions());
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      code?: string;
      state?: string;
      next?: string;
    };
    const code = body.code?.trim();
    const state = body.state?.trim();

    if (!code || !state) {
      return NextResponse.json(
        { ok: false, error: "Falha na autenticação. Tente novamente.", errorCode: "meta_oauth_invalid" },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }

    const result = await completeMetaOAuthExchange(request, {
      code,
      state,
      nextPath: body.next,
    });

    if (!result.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: result.error,
          errorCode: result.errorCode,
          sessionCreated: false,
        },
        { status: result.status, headers: { "Cache-Control": "no-store" } },
      );
    }

    const response = NextResponse.json(
      {
        ok: true,
        sessionCreated: true,
        persistencePending: true,
        redirectTo: result.redirectTo,
      },
      { headers: { "Cache-Control": "no-store" } },
    );

    attachOAuthSessionCookie(response, result.ownerId, result.sessionToken);
    clearOAuthCookies(response);
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro desconhecido";
    console.error("[oauth-meta-exchange-failed]", { code: "meta_exchange_unknown", detail: message });
    return NextResponse.json(
      {
        ok: false,
        error: "Falha ao conectar Instagram. Tente novamente.",
        errorCode: "meta_exchange_unknown",
        sessionCreated: false,
      },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
