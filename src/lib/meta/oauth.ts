import { cookies } from "next/headers";

const SESSION_COOKIE = "insta_scheduler_session";

export async function getSessionUserId(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(SESSION_COOKIE)?.value ?? null;
}

export async function setSessionUserId(userId: string) {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, userId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 60,
    path: "/",
  });
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

export function getMetaAuthUrl(state: string) {
  const appId = process.env.INSTAGRAM_APP_ID || process.env.META_APP_ID!;
  const redirectUri = getRedirectUri();
  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirectUri,
    scope: "instagram_business_basic,instagram_business_content_publish",
    response_type: "code",
    state,
  });

  return `https://www.instagram.com/oauth/authorize?${params.toString()}`;
}

function getInstagramCredentials() {
  return {
    appId: process.env.INSTAGRAM_APP_ID || process.env.META_APP_ID!,
    appSecret: process.env.INSTAGRAM_APP_SECRET || process.env.META_APP_SECRET!,
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

  return {
    access_token: data.access_token as string,
    user_id: String(data.user_id),
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
