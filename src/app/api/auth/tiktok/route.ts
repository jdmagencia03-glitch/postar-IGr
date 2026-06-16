import { NextRequest, NextResponse } from "next/server";
import {
  createOAuthState,
  getOAuthStateCookieOptions,
  getTikTokAuthUrl,
  isTikTokOAuthConfigured,
} from "@/lib/tiktok/oauth";
import { createAdminClient } from "@/lib/supabase/admin";

function sanitizeNextPath(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/dashboard/tiktok";
  }
  return value;
}

export async function GET(request: NextRequest) {
  if (!isTikTokOAuthConfigured()) {
    return NextResponse.json(
      { error: "TikTok OAuth não configurado. Defina TIKTOK_CLIENT_KEY e TIKTOK_CLIENT_SECRET." },
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

  const response = NextResponse.redirect(getTikTokAuthUrl(state));
  response.cookies.set("tiktok_oauth_state", state, getOAuthStateCookieOptions());
  response.cookies.set("tiktok_oauth_next", nextPath, getOAuthStateCookieOptions());
  response.cookies.set(
    "oauth_add_account",
    addAccount ? "1" : "",
    getOAuthStateCookieOptions(),
  );
  return response;
}
