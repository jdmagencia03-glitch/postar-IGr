import { logPublishEvent, markPostPublished } from "@/lib/publish/cron";
import {
  runPlatformPublishCron,
  TIKTOK_POSTS_PER_RUN,
  type AdminClient,
  type PlatformCronRunResult,
  type PlatformPublishResult,
} from "@/lib/publish/cron-run-shared";
import { logSecurityEvent } from "@/lib/security/audit";
import {
  formatCronTikTokPublishLog,
  resolveCronTikTokPrivacyLevel,
} from "@/lib/tiktok/cron-privacy";
import { isTikTokUnauditedClientError } from "@/lib/tiktok/creator";
import { publishTikTokPost, isTikTokPublishError } from "@/lib/tiktok/publish";
import { resolveTikTokUploadMethod } from "@/lib/tiktok/upload-config";
import type { TikTokAccount } from "@/lib/types";

type TikTokPostRow = {
  id: string;
  media_urls?: string[];
  caption?: string | null;
  provider_publish_id?: string | null;
  error_message?: string | null;
  tiktok_accounts?: TikTokAccount | null;
};

async function publishTikTokCronPost(
  supabase: AdminClient,
  post: TikTokPostRow,
): Promise<PlatformPublishResult> {
  const account = post.tiktok_accounts;
  if (!account) {
    throw new Error("Conta TikTok não encontrada");
  }

  const mediaUrls = post.media_urls ?? [];
  if (mediaUrls.length === 0) {
    throw new Error("Post TikTok sem mídia");
  }

  const tiktokVideoUrl = mediaUrls[0] ?? null;
  const lastTikTokError =
    post.error_message ??
    (isTikTokUnauditedClientError(account.last_validation_error ?? "")
      ? account.last_validation_error
      : null);

  const cronPublishLog = formatCronTikTokPublishLog({
    uploadMethod: resolveTikTokUploadMethod(tiktokVideoUrl),
    privacyLevel: resolveCronTikTokPrivacyLevel(undefined, lastTikTokError),
    publishMode: "cron",
    lastTikTokError,
  });

  await logPublishEvent(
    supabase,
    post.id,
    "info",
    `TikTok cron: ${JSON.stringify(cronPublishLog)}`,
  );

  const result = await publishTikTokPost({
    account,
    mediaUrls,
    caption: post.caption ?? undefined,
    existingPublishId: post.provider_publish_id,
    postId: post.id,
    publishMode: "cron",
  });

  await markPostPublished(supabase, post.id, {
    media_id: result.postId,
    permalink: result.permalink,
    provider_publish_id: result.publishId,
    provider_status: result.providerStatus,
    provider_response: result.providerResponse,
  });

  await logSecurityEvent({
    ownerId: account.owner_id,
    eventType: "tiktok_publish",
    resourceType: "scheduled_post",
    resourceId: post.id,
    metadata: {
      publishId: result.publishId,
      privacyLevel: result.privacyLevel,
      uploadMethod: result.uploadMethod,
      publishMode: "cron",
    },
  });

  return {
    mediaId: result.postId,
    permalink: result.permalink,
    providerPublishId: result.publishId,
    providerStatus: result.providerStatus,
    providerResponse: result.providerResponse,
  };
}

export async function runTikTokPublishCron(supabase: AdminClient): Promise<PlatformCronRunResult> {
  return runPlatformPublishCron({
    supabase,
    platform: "tiktok",
    postsPerRun: TIKTOK_POSTS_PER_RUN,
    publishOne: (supabase, post) => publishTikTokCronPost(supabase, post),
    formatSuccessLog: (_post, publishResult) =>
      `Publicado no TikTok: ${publishResult.permalink ?? publishResult.mediaId}`,
    formatErrorLog: (error) =>
      isTikTokPublishError(error) ? error.logMessage : error instanceof Error ? error.message : "Erro TikTok",
  });
}
