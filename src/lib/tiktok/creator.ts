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
  const data = await tiktokApiFetch<{
    data?: TikTokCreatorInfo & { creator_info?: TikTokCreatorInfo };
  }>("/v2/post/publish/creator_info/query/", accessToken, {
    method: "POST",
    body: JSON.stringify({}),
  });

  const payload = data.data;
  if (!payload) return null;

  // API oficial: campos flat em `data` (não aninhados em creator_info).
  if (payload.creator_info) return payload.creator_info;
  if (
    payload.creator_username ||
    payload.creator_nickname ||
    payload.privacy_level_options?.length
  ) {
    return payload;
  }

  return null;
}

export async function queryCreatorInfoForAccount(
  supabase: SupabaseClient,
  account: TikTokAccount,
) {
  const accessToken = await getValidTikTokAccessToken(supabase, account);
  return queryCreatorInfo(accessToken);
}

export type TikTokCreatorInfoLog = {
  creator_username: string;
  privacy_level_options: string[];
  comment_disabled: boolean;
  duet_disabled: boolean;
  stitch_disabled: boolean;
  max_video_post_duration_sec: number;
};

export function formatCreatorInfoLog(creator: TikTokCreatorInfo): TikTokCreatorInfoLog {
  return {
    creator_username: creator.creator_username ?? "",
    privacy_level_options: creator.privacy_level_options ?? [],
    comment_disabled: creator.comment_disabled ?? false,
    duet_disabled: creator.duet_disabled ?? false,
    stitch_disabled: creator.stitch_disabled ?? false,
    max_video_post_duration_sec: creator.max_video_post_duration_sec ?? 0,
  };
}

export function pickDefaultPrivacyLevel(options: string[] | undefined) {
  const privacyOptions = options ?? [];
  if (privacyOptions.includes("PUBLIC_TO_EVERYONE")) return "PUBLIC_TO_EVERYONE";
  if (privacyOptions.includes("MUTUAL_FOLLOW_FRIENDS")) return "MUTUAL_FOLLOW_FRIENDS";
  if (privacyOptions.includes("SELF_ONLY")) return "SELF_ONLY";
  return privacyOptions[0] ?? "SELF_ONLY";
}

/** Privacidade segura para testes com app TikTok não auditado. */
export function pickTestPrivacyLevel(options: string[] | undefined) {
  const privacyOptions = options ?? [];
  if (privacyOptions.includes("SELF_ONLY")) return "SELF_ONLY";
  if (privacyOptions.includes("MUTUAL_FOLLOW_FRIENDS")) return "MUTUAL_FOLLOW_FRIENDS";
  return privacyOptions[0] ?? "SELF_ONLY";
}

export function resolvePrivacyLevel(params: {
  options?: string[];
  requested?: string | null;
  testMode?: boolean;
}) {
  const options = params.options ?? [];

  if (params.requested) {
    if (options.length === 0 || options.includes(params.requested)) {
      return params.requested;
    }
    throw new Error(
      `privacy_level "${params.requested}" indisponível. Opções: ${options.join(", ") || "nenhuma"}`,
    );
  }

  return params.testMode ? pickTestPrivacyLevel(options) : pickDefaultPrivacyLevel(options);
}

export function isTikTokUnauditedClientError(message: string) {
  return /unaudited_client_can_only_post_to_private_accounts/i.test(message);
}

export function hasRequiredPublishScopes(scopes: string | null | undefined) {
  if (!scopes) return false;
  return scopes.includes("video.publish") || scopes.includes("video.upload");
}
