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

export function getMetaAuthUrl(
  state: string,
  options?: { forceReauth?: boolean; enableFbLogin?: boolean },
) {
  const { appId } = getInstagramCredentials();
  const redirectUri = getRedirectUri();
  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirectUri,
    scope: "instagram_business_basic,instagram_business_content_publish",
    response_type: "code",
    state,
  });

  if (options?.forceReauth) {
    params.set("force_reauth", "true");
  }

  params.set("enable_fb_login", options?.enableFbLogin === false ? "0" : "1");

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

  const endpoints = [
    "https://graph.instagram.com/access_token",
    "https://graph.instagram.com/v21.0/access_token",
  ];

  let lastError = "Falha ao obter token de longa duração";

  for (const endpoint of endpoints) {
    const getRes = await fetch(`${endpoint}?${params}`);
    const getData = await getRes.json();

    if (getRes.ok && getData.access_token) {
      return getData.access_token as string;
    }

    lastError = getData.error?.message ?? lastError;

    const postRes = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params,
    });
    const postData = await postRes.json();

    if (postRes.ok && postData.access_token) {
      return postData.access_token as string;
    }

    lastError = postData.error?.message ?? lastError;
  }

  if (lastError.toLowerCase().includes("unsupported request")) {
    throw new Error(
      "Permissões do app Instagram ainda não liberadas. No Meta Developer: Casos de uso → Instagram → solicite Acesso Avançado para instagram_business_basic e instagram_business_content_publish. Confira também se INSTAGRAM_APP_SECRET na Vercel está correto.",
    );
  }

  throw new Error(lastError);
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
export { requireApiSession, getSessionAuth } from "@/lib/auth/api-session";

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
