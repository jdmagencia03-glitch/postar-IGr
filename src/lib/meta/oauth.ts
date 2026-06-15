import { cookies } from "next/headers";
import { randomBytes } from "crypto";
import { getAppUrl } from "@/lib/app-url";

function getRedirectUri() {
  return `${getAppUrl()}/api/auth/meta/callback`;
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

export function createOAuthState() {
  return randomBytes(16).toString("hex");
}

export function getOAuthStateCookieOptions() {
  const isProduction =
    process.env.NODE_ENV === "production" || Boolean(process.env.VERCEL);

  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax" as const,
    maxAge: 600,
    path: "/",
  };
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

export { getSessionUserId, requireSessionUserId } from "@/lib/auth/session";

export async function clearSession() {
  const cookieStore = await cookies();
  cookieStore.set("insta_scheduler_session", "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production" || Boolean(process.env.VERCEL),
    sameSite: "lax",
    maxAge: 0,
    path: "/",
  });
}
