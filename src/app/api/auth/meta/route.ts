import { NextRequest, NextResponse } from "next/server";
import { insertOAuthStateRow, oauthUnavailableRedirect } from "@/lib/auth/oauth-state";
import { createOAuthState, getMetaAuthUrl, getOAuthStateCookieOptions } from "@/lib/meta/oauth";
import { createAdminClient } from "@/lib/supabase/admin";

function sanitizeNextPath(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/dashboard";
  }
  return value;
}

export async function GET(request: NextRequest) {
  const state = createOAuthState();
  const nextPath = sanitizeNextPath(request.nextUrl.searchParams.get("next"));
  const addAccount = request.nextUrl.searchParams.get("add_account") === "1";
  const supabase = createAdminClient();

  const stored = await insertOAuthStateRow(supabase, state, nextPath, "oauth-meta-state-insert");
  if (!stored) {
    return NextResponse.redirect(oauthUnavailableRedirect(request.url));
  }

  const response = NextResponse.redirect(
    getMetaAuthUrl(state, {
      forceReauth: addAccount,
      enableFbLogin: true,
    }),
  );
  response.cookies.set("meta_oauth_state", state, getOAuthStateCookieOptions());
  response.cookies.set("meta_oauth_next", nextPath, getOAuthStateCookieOptions());
  response.cookies.set(
    "oauth_add_account",
    addAccount ? "1" : "",
    getOAuthStateCookieOptions(),
  );
  return response;
}
