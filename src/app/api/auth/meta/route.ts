import { NextRequest, NextResponse } from "next/server";
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
  const supabase = createAdminClient();

  await supabase.from("oauth_states").insert({
    state,
    next_path: nextPath,
  });

  const response = NextResponse.redirect(getMetaAuthUrl(state));
  response.cookies.set("meta_oauth_state", state, getOAuthStateCookieOptions());
  response.cookies.set("meta_oauth_next", nextPath, getOAuthStateCookieOptions());
  return response;
}
