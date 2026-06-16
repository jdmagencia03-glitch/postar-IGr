import { NextRequest, NextResponse } from "next/server";
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

  await supabase.from("oauth_states").insert({
    state,
    next_path: nextPath,
  });

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
