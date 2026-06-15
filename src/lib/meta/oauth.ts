import { cookies } from "next/headers";
import { randomBytes } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";

export const SESSION_COOKIE = "insta_scheduler_session";

export function getSessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    maxAge: 60 * 60 * 24 * 60,
    path: "/",
  };
}

export function createSessionToken() {
  return randomBytes(32).toString("hex");
}

export async function getSessionUserId(): Promise<string | null> {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(SESSION_COOKIE)?.value;
  if (!sessionToken) return null;

  if (/^\d+$/.test(sessionToken)) {
    return sessionToken;
  }

  const supabase = createAdminClient();
  const { data } = await supabase
    .from("app_sessions")
    .select("user_id")
    .eq("session_token", sessionToken)
    .maybeSingle();

  return data?.user_id ?? null;
}

export async function setSessionUserId(userId: string) {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, userId, getSessionCookieOptions());
}

export async function clearSession() {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
}

function getRedirectUri() {
  const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  if (base) return `${base}/api/auth/meta/callback`;
  return process.env.META_REDIRECT_URI!.replace(/\/$/, "");
}

function getInstagramCredentials() {
  const appId = process.env.INSTAGRAM_APP_ID;
  const appSecret = process.env.INSTAGRAM_APP_SECRET;

  if (!appId || !appSecret) {
    throw new Error("INSTAGRAM_APP_ID e INSTAGRAM_APP_SECRET são obrigatórios");
  }

  return { appId, appSecret };
}

export function getMetaAuthUrl(state: string) {
  const { appId } = getInstagramCredentials();
  const redirectUri = getRedirectUri();
  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirectUri,
    scope: "instagram_business_basic,instagram_business_content_publish",
    response_type: "code",
    state,
    enable_fb_login: "0",
  });

  return `https://www.instagram.com/oauth/authorize?${params.toString()}`;
}

export async function exchangeCodeForToken(code: string) {
  const { appId, appSecret } = getInstagramCredentials();

  const res = await fetch("https://api.instagram.com/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: appId,
      client_secret: appSecret,
      grant_type: "authorization_code",
      redirect_uri: getRedirectUri(),
      code,
    }),
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.error_message ?? data.error?.message ?? "Falha ao trocar código por token");
  }

  const tokenEntry = Array.isArray(data.data) ? data.data[0] : data;

  if (!tokenEntry?.access_token || !tokenEntry?.user_id) {
    throw new Error("Resposta de token inválida da API do Instagram");
  }

  return {
    access_token: tokenEntry.access_token as string,
    user_id: String(tokenEntry.user_id),
  };
}

export async function getLongLivedToken(shortToken: string) {
  const { appSecret } = getInstagramCredentials();
  const params = new URLSearchParams({
    grant_type: "ig_exchange_token",
    client_secret: appSecret,
    access_token: shortToken,
  });

  const res = await fetch(`https://graph.instagram.com/access_token?${params}`);
  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.error?.message ?? "Falha ao obter token de longa duração");
  }

  return data.access_token as string;
}

export async function getInstagramProfile(accessToken: string) {
  const fields = "id,username,profile_picture_url,account_type";
  const res = await fetch(
    `https://graph.instagram.com/v21.0/me?fields=${fields}&access_token=${accessToken}`,
  );
  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.error?.message ?? "Falha ao obter perfil Instagram");
  }

  return data as {
    id: string;
    username: string;
    profile_picture_url?: string;
    account_type?: string;
  };
}
