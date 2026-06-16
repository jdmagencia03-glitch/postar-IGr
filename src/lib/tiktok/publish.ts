import { createAdminClient } from "@/lib/supabase/admin";
import { ensureTikTokAccessToken } from "@/lib/tiktok/accounts";
import type { TikTokAccount } from "@/lib/types";

const TIKTOK_API = "https://open.tiktokapis.com";

interface TikTokApiError {
  code?: string;
  message?: string;
}

async function tiktokFetch<T>(
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
    throw new Error(data.error?.message ?? `Erro TikTok API (${res.status})`);
  }

  return data;
}

async function queryCreatorInfo(accessToken: string) {
  const data = await tiktokFetch<{
    data?: {
      creator_info?: {
        privacy_level_options?: string[];
        comment_disabled?: boolean;
        duet_disabled?: boolean;
        stitch_disabled?: boolean;
      };
    };
  }>("/v2/post/publish/creator_info/query/", accessToken, {
    method: "POST",
    body: JSON.stringify({}),
  });

  return data.data?.creator_info;
}

export async function publishTikTokPost(params: {
  account: TikTokAccount;
  mediaUrls: string[];
  caption?: string;
}) {
  const supabase = createAdminClient();
  const accessToken = await ensureTikTokAccessToken(supabase, params.account);
  const videoUrl = params.mediaUrls[0];

  if (!videoUrl) {
    throw new Error("URL do vídeo TikTok não informada");
  }

  const creator = await queryCreatorInfo(accessToken);
  const privacyOptions = creator?.privacy_level_options ?? [];
  const privacyLevel = privacyOptions.includes("PUBLIC_TO_EVERYONE")
    ? "PUBLIC_TO_EVERYONE"
    : privacyOptions.includes("SELF_ONLY")
      ? "SELF_ONLY"
      : privacyOptions[0] ?? "SELF_ONLY";

  const initData = await tiktokFetch<{
    data?: { publish_id?: string };
  }>("/v2/post/publish/video/init/", accessToken, {
    method: "POST",
    body: JSON.stringify({
      post_info: {
        title: params.caption?.slice(0, 2200) ?? "",
        privacy_level: privacyLevel,
        disable_duet: creator?.duet_disabled ?? false,
        disable_stitch: creator?.stitch_disabled ?? false,
        disable_comment: creator?.comment_disabled ?? false,
        brand_content_toggle: false,
        brand_organic_toggle: false,
      },
      source_info: {
        source: "PULL_FROM_URL",
        video_url: videoUrl,
      },
    }),
  });

  const publishId = initData.data?.publish_id;
  if (!publishId) {
    throw new Error("Falha ao iniciar publicação no TikTok");
  }

  for (let attempt = 0; attempt < 30; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 2000));

    const statusData = await tiktokFetch<{
      data?: {
        status?: string;
        publish_id?: string;
        publicaly_available_post_id?: string[];
      };
    }>("/v2/post/publish/status/fetch/", accessToken, {
      method: "POST",
      body: JSON.stringify({ publish_id: publishId }),
    });

    const status = statusData.data?.status;
    if (status === "PUBLISH_COMPLETE") {
      const postId = statusData.data?.publicaly_available_post_id?.[0] ?? publishId;
      return {
        publishId,
        postId,
        permalink: postId.startsWith("http")
          ? postId
          : `https://www.tiktok.com/@${params.account.username ?? "user"}/video/${postId}`,
        privacyLevel,
      };
    }

    if (status === "FAILED") {
      throw new Error(
        `TikTok rejeitou a publicação do vídeo (publish_id: ${publishId}). Verifique formato MP4, URL pública e limites da conta.`,
      );
    }
  }

  throw new Error("Tempo esgotado aguardando publicação no TikTok");
}
