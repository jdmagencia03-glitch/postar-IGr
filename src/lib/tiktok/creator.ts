import type { TikTokAccount } from "@/lib/types";
import { getValidTikTokAccessToken } from "@/lib/tiktok/accounts";
import type { SupabaseClient } from "@supabase/supabase-js";

const TIKTOK_API = "https://open.tiktokapis.com";

export interface TikTokCreatorInfo {
  creator_avatar_url?: string;
  creator_username?: string;
  creator_nickname?: string;
  privacy_level_options?: string[];
  comment_disabled?: boolean;
  duet_disabled?: boolean;
  stitch_disabled?: boolean;
  max_video_post_duration_sec?: number;
}

interface TikTokApiError {
  code?: string;
  message?: string;
  log_id?: string;
}

export async function tiktokApiFetch<T>(
  path: string,
  accessToken: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`${TIKTOK_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=UTF-8",
      ...(init?.headers ?? {}),
    },
  });

  const data = (await res.json()) as T & { error?: TikTokApiError };

  if (!res.ok || (data.error && data.error.code !== "ok")) {
    const code = data.error?.code ?? `http_${res.status}`;
    const message = data.error?.message ?? `Erro TikTok API (${res.status})`;
    throw new Error(`${code}: ${message}`);
  }

  return data;
}

export async function queryCreatorInfo(accessToken: string) {
  const data = await tiktokApiFetch<{ data?: { creator_info?: TikTokCreatorInfo } }>(
    "/v2/post/publish/creator_info/query/",
    accessToken,
    { method: "POST", body: JSON.stringify({}) },
  );

  return data.data?.creator_info ?? null;
}

export async function queryCreatorInfoForAccount(
  supabase: SupabaseClient,
  account: TikTokAccount,
) {
  const accessToken = await getValidTikTokAccessToken(supabase, account);
  return queryCreatorInfo(accessToken);
}

export function pickDefaultPrivacyLevel(options: string[] | undefined) {
  const privacyOptions = options ?? [];
  if (privacyOptions.includes("PUBLIC_TO_EVERYONE")) return "PUBLIC_TO_EVERYONE";
  if (privacyOptions.includes("SELF_ONLY")) return "SELF_ONLY";
  return privacyOptions[0] ?? "SELF_ONLY";
}

export function hasRequiredPublishScopes(scopes: string | null | undefined) {
  if (!scopes) return false;
  return scopes.includes("video.publish") || scopes.includes("video.upload");
}
