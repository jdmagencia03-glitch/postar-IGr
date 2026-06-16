import { randomBytes } from "crypto";
import { getAppUrl } from "@/lib/app-url";

const DEFAULT_TIKTOK_SCOPES = [
  "user.info.basic",
  "user.info.profile",
  "video.upload",
  "video.publish",
];

export function getTikTokOAuthScopes() {
  const fromEnv = process.env.TIKTOK_OAUTH_SCOPES?.trim();
  if (fromEnv) {
    return fromEnv
      .split(",")
      .map((scope) => scope.trim())
      .filter(Boolean)
      .join(",");
  }
  return DEFAULT_TIKTOK_SCOPES.join(",");
}

export const TIKTOK_SCOPES = DEFAULT_TIKTOK_SCOPES.join(",");

export function getTikTokRedirectUri() {
  const fromEnv = process.env.TIKTOK_REDIRECT_URI?.trim().replace(/\/$/, "");
  if (fromEnv) return fromEnv;
  return `${getAppUrl()}/api/auth/tiktok/callback`;
}

export function isTikTokOAuthConfigured() {
  return Boolean(process.env.TIKTOK_CLIENT_KEY && process.env.TIKTOK_CLIENT_SECRET);
}

function getTikTokCredentials() {
  const clientKey = process.env.TIKTOK_CLIENT_KEY;
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET;

  if (!clientKey || !clientSecret) {
    throw new Error("TIKTOK_CLIENT_KEY e TIKTOK_CLIENT_SECRET são obrigatórios");
  }

  return { clientKey, clientSecret };
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

export function getTikTokAuthUrl(state: string) {
  const { clientKey } = getTikTokCredentials();
  const params = new URLSearchParams({
    client_key: clientKey,
    scope: getTikTokOAuthScopes(),
    response_type: "code",
    redirect_uri: getTikTokRedirectUri(),
    state,
  });

  return `https://www.tiktok.com/v2/auth/authorize/?${params.toString()}`;
}

export interface TikTokTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  refresh_expires_in: number;
  open_id: string;
  scope: string;
  token_type: string;
}

async function parseTokenResponse(res: Response) {
  const data = (await res.json()) as TikTokTokenResponse & {
    error?: string;
    error_description?: string;
  };

  if (!res.ok || data.error) {
    throw new Error(data.error_description ?? data.error ?? "Falha na autenticação TikTok");
  }

  if (!data.access_token || !data.refresh_token) {
    throw new Error("Resposta de token TikTok inválida");
  }

  return data;
}

export async function exchangeCodeForToken(code: string) {
  const { clientKey, clientSecret } = getTikTokCredentials();

  const res = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_key: clientKey,
      client_secret: clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: getTikTokRedirectUri(),
    }),
  });

  return parseTokenResponse(res);
}

export async function refreshAccessToken(refreshToken: string) {
  const { clientKey, clientSecret } = getTikTokCredentials();

  const res = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_key: clientKey,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });

  return parseTokenResponse(res);
}

export async function getTikTokProfile(accessToken: string) {
  const fields = "open_id,union_id,avatar_url,display_name,username";
  const res = await fetch(
    `https://open.tiktokapis.com/v2/user/info/?fields=${encodeURIComponent(fields)}`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );

  const data = (await res.json()) as {
    data?: {
      user?: {
        open_id?: string;
        username?: string;
        display_name?: string;
        avatar_url?: string;
      };
    };
    error?: { code?: string; message?: string };
  };

  if (!res.ok || data.error?.code !== "ok") {
    throw new Error(data.error?.message ?? "Falha ao obter perfil TikTok");
  }

  const user = data.data?.user;
  if (!user?.open_id) {
    throw new Error("Perfil TikTok inválido");
  }

  return {
    open_id: user.open_id,
    username: user.username ?? null,
    display_name: user.display_name ?? null,
    profile_picture_url: user.avatar_url ?? null,
  };
}
