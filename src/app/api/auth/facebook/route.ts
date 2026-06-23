import { NextRequest, NextResponse } from "next/server";
import { persistOAuthStateRow } from "@/lib/auth/oauth-state";
import { createOAuthState, getOAuthStateCookieOptions } from "@/lib/meta/oauth";
import {
  getFacebookAuthUrl,
  isFacebookOAuthConfigured,
} from "@/lib/meta/facebook-oauth";
import { createAdminClient } from "@/lib/supabase/admin";

function sanitizeNextPath(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/dashboard/accounts";
  }
  return value;
}

export async function GET(request: NextRequest) {
  if (!isFacebookOAuthConfigured()) {
    return NextResponse.json(
      {
        error:
          "META_APP_ID e META_APP_SECRET não configurados. Adicione na Vercel para usar login via Facebook.",
      },
      { status: 503 },
    );
  }

  const state = createOAuthState();
  const nextPath = sanitizeNextPath(request.nextUrl.searchParams.get("next"));
  const addAccount = request.nextUrl.searchParams.get("add_account") === "1";
  const supabase = createAdminClient();

  await persistOAuthStateRow(supabase, state, nextPath, "oauth-facebook-state-insert");

  const response = NextResponse.redirect(
    getFacebookAuthUrl(state, { forceReauth: addAccount }),
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
