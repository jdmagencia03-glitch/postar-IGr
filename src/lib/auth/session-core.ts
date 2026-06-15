export const SESSION_COOKIE = "insta_scheduler_session";
export const USER_ID_HEADER = "x-user-id";

export function isProduction() {
  return process.env.NODE_ENV === "production" || Boolean(process.env.VERCEL);
}

export function getSessionCookieOptions() {
  return {
    httpOnly: true,
    secure: isProduction(),
    sameSite: "lax" as const,
    maxAge: 60 * 60 * 24 * 60,
    path: "/",
  };
}

export function getSessionCookieDeleteOptions() {
  return {
    httpOnly: true,
    secure: isProduction(),
    sameSite: "lax" as const,
    maxAge: 0,
    path: "/",
  };
}

export async function lookupSessionToken(token: string): Promise<string | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;

  const res = await fetch(
    `${url}/rest/v1/app_sessions?session_token=eq.${encodeURIComponent(token)}&select=user_id&limit=1`,
    {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
      cache: "no-store",
    },
  );

  if (!res.ok) return null;

  const data = (await res.json()) as Array<{ user_id: string }>;
  return data[0]?.user_id ?? null;
}
