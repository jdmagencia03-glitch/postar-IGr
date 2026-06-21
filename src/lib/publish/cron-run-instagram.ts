import { publishPost, formatInstagramPublishError } from "@/lib/meta/instagram";
import { isInstagramContainerProcessingError } from "@/lib/meta/instagram-container";
import { publishInstagramStory } from "@/lib/meta/instagram-stories";
import { markPostPublished } from "@/lib/publish/cron";
import {
  INSTAGRAM_POSTS_PER_RUN,
  runPlatformPublishCron,
  type AdminClient,
  type PlatformCronRunResult,
  type PlatformPublishResult,
} from "@/lib/publish/cron-run-shared";
import { cleanupPublishedMedia } from "@/lib/storage/cleanup";
import { decryptPageAccessToken } from "@/lib/security/tokens";
import type { MediaType } from "@/lib/types";

type InstagramPostRow = {
  id: string;
  media_type?: string;
  media_urls?: string[];
  caption?: string | null;
  content_type?: string | null;
  instagram_accounts?: {
    ig_user_id: string;
    page_access_token: string;
    auth_provider?: "instagram" | "facebook" | null;
  } | null;
};

async function publishInstagramPost(
  _supabase: AdminClient,
  post: InstagramPostRow,
): Promise<PlatformPublishResult> {
  const account = post.instagram_accounts;
  if (!account) {
    throw new Error("Conta Instagram não encontrada");
  }

  const mediaUrls = post.media_urls ?? [];
  if (mediaUrls.length === 0) {
    throw new Error("Post Instagram sem mídia");
  }

  const accessToken = decryptPageAccessToken(account.page_access_token);
  if (!accessToken) {
    throw new Error("Token da conta indisponível");
  }

  const provider = account.auth_provider === "facebook" ? "facebook" : "instagram";
  const contentType = post.content_type ?? "reel";

  if (contentType === "story") {
    const mediaUrl = mediaUrls[0];
    if (!mediaUrl) {
      throw new Error("Story sem mídia");
    }

    const result = await publishInstagramStory({
      igUserId: account.ig_user_id,
      token: accessToken,
      mediaUrl,
      provider,
    });

    await markPostPublished(_supabase, post.id, {
      container_id: result.containerId,
      media_id: result.mediaId,
      permalink: result.permalink,
    });

    return {
      containerId: result.containerId,
      mediaId: result.mediaId,
      permalink: result.permalink,
    };
  }

  const result = await publishPost({
    igUserId: account.ig_user_id,
    token: accessToken,
    mediaType: (post.media_type ?? "REELS") as MediaType,
    mediaUrls,
    caption: post.caption ?? undefined,
    provider,
  }).catch(async (err) => {
    if (isInstagramContainerProcessingError(err)) {
      await _supabase
        .from("scheduled_posts")
        .update({ container_id: err.containerId })
        .eq("id", post.id);
    }
    throw err;
  });

  await markPostPublished(_supabase, post.id, {
    container_id: result.containerId,
    media_id: result.mediaId,
    permalink: result.permalink,
  });

  return {
    containerId: result.containerId,
    mediaId: result.mediaId,
    permalink: result.permalink,
  };
}

export type InstagramCronRunResult = PlatformCronRunResult & {
  media_cleanup: Awaited<ReturnType<typeof cleanupPublishedMedia>> | { error: string } | null;
};

export async function runInstagramPublishCron(supabase: AdminClient): Promise<InstagramCronRunResult> {
  const result = await runPlatformPublishCron({
    supabase,
    platform: "instagram",
    postsPerRun: INSTAGRAM_POSTS_PER_RUN,
    publishOne: (supabase, post) => publishInstagramPost(supabase, post),
    formatSuccessLog: (_post, publishResult) =>
      `Publicado: ${publishResult.permalink ?? publishResult.mediaId}`,
    formatErrorLog: (error) => formatInstagramPublishError(error),
  });

  let mediaCleanup: InstagramCronRunResult["media_cleanup"] = null;
  try {
    mediaCleanup = await cleanupPublishedMedia(supabase);
  } catch (err) {
    console.error("[publish/instagram] media cleanup error:", err);
    mediaCleanup = {
      error: err instanceof Error ? err.message : "Falha na limpeza de mídia",
    };
  }

  return {
    ...result,
    media_cleanup: mediaCleanup,
  };
}
