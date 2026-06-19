import { createAdminClient } from "@/lib/supabase/admin";
import { getValidTikTokAccessToken } from "@/lib/tiktok/accounts";
import {
  pickDefaultPrivacyLevel,
  queryCreatorInfo,
  tiktokApiFetch,
} from "@/lib/tiktok/creator";
import type { TikTokAccount } from "@/lib/types";

export interface TikTokPublishResult {
  publishId: string;
  postId: string;
  permalink: string | null;
  privacyLevel: string;
  providerStatus: string;
  providerResponse: Record<string, unknown>;
}

async function assertVideoUrlAccessible(videoUrl: string) {
  const head = await fetch(videoUrl, { method: "HEAD" }).catch(() => null);
  if (!head?.ok) {
    const get = await fetch(videoUrl, { method: "GET", headers: { Range: "bytes=0-1" } }).catch(
      () => null,
    );
    if (!get?.ok) {
      throw new Error(
        "URL do vídeo inacessível para o TikTok. Verifique se o arquivo está público ou use URL assinada válida.",
      );
    }
  }
}

export async function publishTikTokPost(params: {
  account: TikTokAccount;
  mediaUrls: string[];
  caption?: string;
  existingPublishId?: string | null;
}) {
  if (params.existingPublishId) {
    throw new Error("Post já possui publish_id TikTok — republicação bloqueada");
  }

  const supabase = createAdminClient();
  const accessToken = await getValidTikTokAccessToken(supabase, params.account);
  const videoUrl = params.mediaUrls[0];

  if (!videoUrl) {
    throw new Error("URL do vídeo TikTok não informada");
  }

  await assertVideoUrlAccessible(videoUrl);

  const creator = await queryCreatorInfo(accessToken);
  if (!creator) {
    throw new Error("creator_info indisponível — valide permissões e scope video.publish");
  }

  const privacyLevel = pickDefaultPrivacyLevel(creator.privacy_level_options);
  const maxDuration =
    creator.max_video_post_duration_sec ?? params.account.creator_max_duration_sec ?? null;

  if (maxDuration) {
    // Duração exata exige metadados do arquivo; validação completa ocorre na API TikTok.
    // Persistimos o limite para mensagens de erro mais claras.
  }

  const initData = await tiktokApiFetch<{
    data?: { publish_id?: string };
  }>("/v2/post/publish/video/init/", accessToken, {
    method: "POST",
    body: JSON.stringify({
      post_info: {
        title: params.caption?.slice(0, 2200) ?? "",
        privacy_level: privacyLevel,
        disable_duet: creator.duet_disabled ?? false,
        disable_stitch: creator.stitch_disabled ?? false,
        disable_comment: creator.comment_disabled ?? false,
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

  let lastStatus = "PROCESSING";
  let lastResponse: Record<string, unknown> = { publish_id: publishId };

  for (let attempt = 0; attempt < 30; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 2000));

    const statusData = await tiktokApiFetch<{
      data?: {
        status?: string;
        publish_id?: string;
        publicaly_available_post_id?: string[];
        fail_reason?: string;
      };
    }>("/v2/post/publish/status/fetch/", accessToken, {
      method: "POST",
      body: JSON.stringify({ publish_id: publishId }),
    });

    lastStatus = statusData.data?.status ?? lastStatus;
    lastResponse = { ...(statusData.data ?? {}), publish_id: publishId };

    if (lastStatus === "PUBLISH_COMPLETE") {
      const postId = statusData.data?.publicaly_available_post_id?.[0] ?? publishId;
      const username =
        creator.creator_username ?? params.account.creator_username ?? params.account.username;
      return {
        publishId,
        postId,
        permalink: postId.startsWith("http")
          ? postId
          : username
            ? `https://www.tiktok.com/@${username}/video/${postId}`
            : null,
        privacyLevel,
        providerStatus: lastStatus,
        providerResponse: lastResponse,
      } satisfies TikTokPublishResult;
    }

    if (lastStatus === "FAILED") {
      const reason = statusData.data?.fail_reason;
      const durationHint = maxDuration ? ` (máx. ${maxDuration}s nesta conta)` : "";
      throw new Error(
        reason
          ? `TikTok rejeitou o vídeo: ${reason}${durationHint}`
          : `TikTok rejeitou a publicação${durationHint}. Verifique formato MP4, URL pública e limites da conta.`,
      );
    }
  }

  throw new Error(
    `Tempo esgotado aguardando publicação no TikTok (último status: ${lastStatus})`,
  );
}
