import { createAdminClient } from "@/lib/supabase/admin";
import { getValidTikTokAccessToken } from "@/lib/tiktok/accounts";
import {
  formatCreatorInfoLog,
  queryCreatorInfo,
  tiktokApiFetch,
} from "@/lib/tiktok/creator";
import {
  formatCronTikTokPublishLog,
  resolveTikTokPublishPrivacyLevel,
  type TikTokPublishMode,
} from "@/lib/tiktok/cron-privacy";
import {
  computeTikTokChunks,
  downloadVideoForTikTok,
  formatTikTokChunkPlanLog,
  uploadVideoChunksToTikTok,
  type TikTokChunkPlan,
  type TikTokChunkPlanLog,
} from "@/lib/tiktok/file-upload";
import {
  formatTikTokPublishFailureLog,
  resolveTikTokUploadMethod,
  type TikTokUploadMethod,
} from "@/lib/tiktok/upload-config";
import type { TikTokAccount } from "@/lib/types";

export interface TikTokPublishResult {
  publishId: string;
  postId: string;
  permalink: string | null;
  privacyLevel: string;
  providerStatus: string;
  providerResponse: Record<string, unknown>;
  uploadMethod: TikTokUploadMethod;
}

export class TikTokPublishError extends Error {
  uploadMethod: TikTokUploadMethod;
  videoUrl: string | null;
  logMessage: string;
  chunkPlan?: TikTokChunkPlan;
  chunkPlanLog?: TikTokChunkPlanLog;

  constructor(params: {
    message: string;
    uploadMethod: TikTokUploadMethod;
    videoUrl: string | null;
    chunkPlan?: TikTokChunkPlan;
    chunkPlanLog?: TikTokChunkPlanLog;
  }) {
    super(params.message);
    this.name = "TikTokPublishError";
    this.uploadMethod = params.uploadMethod;
    this.videoUrl = params.videoUrl;
    this.chunkPlan = params.chunkPlan;
    this.chunkPlanLog = params.chunkPlanLog;
    this.logMessage = formatTikTokPublishFailureLog({
      method: params.uploadMethod,
      videoUrl: params.videoUrl,
      message: params.message,
    });
  }
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

async function pollTikTokPublishStatus(params: {
  accessToken: string;
  publishId: string;
  creatorUsername: string | null;
  accountUsername: string | null;
  maxDurationSec: number | null;
  privacyLevel: string;
  uploadMethod: TikTokUploadMethod;
  maxAttempts?: number;
}) {
  let lastStatus = "PROCESSING";
  let lastResponse: Record<string, unknown> = { publish_id: params.publishId };

  for (let attempt = 0; attempt < (params.maxAttempts ?? 30); attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 2000));

    const statusData = await tiktokApiFetch<{
      data?: {
        status?: string;
        publish_id?: string;
        publicaly_available_post_id?: string[];
        fail_reason?: string;
      };
    }>("/v2/post/publish/status/fetch/", params.accessToken, {
      method: "POST",
      body: JSON.stringify({ publish_id: params.publishId }),
    });

    lastStatus = statusData.data?.status ?? lastStatus;
    lastResponse = {
      ...(statusData.data ?? {}),
      publish_id: params.publishId,
      upload_method: params.uploadMethod,
    };

    if (lastStatus === "PUBLISH_COMPLETE") {
      const postId = statusData.data?.publicaly_available_post_id?.[0] ?? params.publishId;
      const username = params.creatorUsername ?? params.accountUsername;
      return {
        publishId: params.publishId,
        postId,
        permalink: postId.startsWith("http")
          ? postId
          : username
            ? `https://www.tiktok.com/@${username}/video/${postId}`
            : null,
        privacyLevel: params.privacyLevel,
        providerStatus: lastStatus,
        providerResponse: lastResponse,
        uploadMethod: params.uploadMethod,
      } satisfies TikTokPublishResult;
    }

    if (lastStatus === "FAILED") {
      const reason = statusData.data?.fail_reason;
      const durationHint = params.maxDurationSec ? ` (máx. ${params.maxDurationSec}s nesta conta)` : "";
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

type InitPostInfo = {
  title: string;
  privacy_level: string;
  disable_duet: boolean;
  disable_stitch: boolean;
  disable_comment: boolean;
  brand_content_toggle: boolean;
  brand_organic_toggle: boolean;
};

async function initDirectPost(params: {
  accessToken: string;
  postInfo: InitPostInfo;
  sourceInfo: Record<string, unknown>;
}) {
  return tiktokApiFetch<{
    data?: { publish_id?: string; upload_url?: string };
  }>("/v2/post/publish/video/init/", params.accessToken, {
    method: "POST",
    body: JSON.stringify({
      post_info: params.postInfo,
      source_info: params.sourceInfo,
    }),
  });
}

async function publishViaPullFromUrl(params: {
  accessToken: string;
  videoUrl: string;
  postInfo: InitPostInfo;
}) {
  await assertVideoUrlAccessible(params.videoUrl);

  const initData = await initDirectPost({
    accessToken: params.accessToken,
    postInfo: params.postInfo,
    sourceInfo: {
      source: "PULL_FROM_URL",
      video_url: params.videoUrl,
    },
  });

  const publishId = initData.data?.publish_id;
  if (!publishId) {
    throw new Error("Falha ao iniciar publicação no TikTok (PULL_FROM_URL)");
  }

  return publishId;
}

async function publishViaFileUpload(params: {
  accessToken: string;
  videoUrl: string;
  postInfo: InitPostInfo;
}) {
  const downloaded = await downloadVideoForTikTok(params.videoUrl);
  const chunkPlan = computeTikTokChunks(downloaded.size);
  const chunkPlanLog = formatTikTokChunkPlanLog(chunkPlan);

  console.info("[tiktok-file-upload-init]", JSON.stringify(chunkPlanLog));

  try {
    const initData = await initDirectPost({
      accessToken: params.accessToken,
      postInfo: params.postInfo,
      sourceInfo: {
        source: "FILE_UPLOAD",
        video_size: chunkPlan.videoSize,
        chunk_size: chunkPlan.chunkSize,
        total_chunk_count: chunkPlan.totalChunkCount,
      },
    });

    const publishId = initData.data?.publish_id;
    const uploadUrl = initData.data?.upload_url;

    if (!publishId || !uploadUrl) {
      throw new Error("Falha ao iniciar publicação no TikTok (FILE_UPLOAD — publish_id/upload_url ausentes)");
    }

    await uploadVideoChunksToTikTok({
      uploadUrl,
      buffer: downloaded.buffer,
      chunks: chunkPlan.chunks,
      contentType: downloaded.contentType,
    });

    return publishId;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha no FILE_UPLOAD TikTok";
    throw new TikTokPublishError({
      message,
      uploadMethod: "FILE_UPLOAD",
      videoUrl: params.videoUrl,
      chunkPlan,
      chunkPlanLog,
    });
  }
}

export async function publishTikTokPost(params: {
  account: TikTokAccount;
  mediaUrls: string[];
  caption?: string;
  existingPublishId?: string | null;
  postId?: string;
  uploadMethod?: TikTokUploadMethod;
  privacyLevel?: string;
  /** Quando true, usa SELF_ONLY por padrão se privacyLevel não for informado. */
  testMode?: boolean;
  /** cron = publicador automático; admin_test = test-publish manual. */
  publishMode?: TikTokPublishMode;
}) {
  const supabase = createAdminClient();
  const accessToken = await getValidTikTokAccessToken(supabase, params.account);
  const creator = await queryCreatorInfo(accessToken);
  if (!creator) {
    throw new Error("creator_info indisponível — valide permissões e scope video.publish");
  }

  const creatorInfoLog = formatCreatorInfoLog(creator);
  console.info("[tiktok-creator-info]", JSON.stringify(creatorInfoLog));

  let lastTikTokError = params.account.last_validation_error ?? null;
  if (params.postId) {
    const { data: postRow } = await supabase
      .from("scheduled_posts")
      .select("error_message")
      .eq("id", params.postId)
      .maybeSingle();
    if (postRow?.error_message) {
      lastTikTokError = postRow.error_message;
    }
  }

  const privacyLevel = resolveTikTokPublishPrivacyLevel({
    options: creator.privacy_level_options,
    requested: params.privacyLevel,
    publishMode: params.publishMode,
    testMode: params.testMode,
    lastTikTokError,
  });
  const maxDuration =
    creator.max_video_post_duration_sec ?? params.account.creator_max_duration_sec ?? null;
  const creatorUsername =
    creator.creator_username ?? params.account.creator_username ?? params.account.username;

  const videoUrl = params.mediaUrls[0] ?? null;
  const uploadMethod = params.uploadMethod ?? resolveTikTokUploadMethod(videoUrl);

  if (params.publishMode === "cron") {
    console.info(
      "[tiktok-cron-publish]",
      JSON.stringify(
        formatCronTikTokPublishLog({
          uploadMethod,
          privacyLevel,
          publishMode: "cron",
          privacyLevelOptions: creator.privacy_level_options,
          lastTikTokError,
        }),
      ),
    );
  }

  if (params.existingPublishId) {
    return pollTikTokPublishStatus({
      accessToken,
      publishId: params.existingPublishId,
      creatorUsername,
      accountUsername: params.account.username,
      maxDurationSec: maxDuration,
      privacyLevel,
      uploadMethod,
    });
  }

  if (!videoUrl) {
    throw new Error("URL do vídeo TikTok não informada");
  }

  const postInfo: InitPostInfo = {
    title: params.caption?.slice(0, 2200) ?? "",
    privacy_level: privacyLevel,
    disable_duet: creator.duet_disabled ?? false,
    disable_stitch: creator.stitch_disabled ?? false,
    disable_comment: creator.comment_disabled ?? false,
    brand_content_toggle: false,
    brand_organic_toggle: false,
  };

  console.info(
    "[tiktok-publish-init-post]",
    JSON.stringify({
      privacy_level: postInfo.privacy_level,
      disable_duet: postInfo.disable_duet,
      disable_stitch: postInfo.disable_stitch,
      disable_comment: postInfo.disable_comment,
      creatorInfo: creatorInfoLog,
    }),
  );

  try {
    const publishId =
      uploadMethod === "FILE_UPLOAD"
        ? await publishViaFileUpload({ accessToken, videoUrl, postInfo })
        : await publishViaPullFromUrl({ accessToken, videoUrl, postInfo });

    if (params.postId) {
      await supabase
        .from("scheduled_posts")
        .update({
          provider_publish_id: publishId,
          provider_status: "PROCESSING",
          updated_at: new Date().toISOString(),
        })
        .eq("id", params.postId)
        .is("media_id", null);
    }

    console.info("[tiktok-publish-init]", {
      accountId: params.account.id,
      postId: params.postId ?? null,
      uploadMethod,
      privacyLevel,
      videoSourceHost: new URL(videoUrl).host,
      publishId,
    });

    return pollTikTokPublishStatus({
      accessToken,
      publishId,
      creatorUsername,
      accountUsername: params.account.username,
      maxDurationSec: maxDuration,
      privacyLevel,
      uploadMethod,
    });
  } catch (error) {
    if (error instanceof TikTokPublishError) {
      throw error;
    }
    const message = error instanceof Error ? error.message : "Falha na publicação TikTok";
    throw new TikTokPublishError({ message, uploadMethod, videoUrl });
  }
}

export function isTikTokPublishError(error: unknown): error is TikTokPublishError {
  return error instanceof TikTokPublishError;
}
