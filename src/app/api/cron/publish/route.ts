import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { publishPost } from "@/lib/meta/instagram";
import {
  assertSafeToPublish,
  claimPostForProcessing,
  logPublishEvent,
  markPostFailed,
  markPostPublishCriticalFailure,
  markPostPublished,
  PublishGuardError,
  recoverStaleProcessingPosts,
} from "@/lib/publish/cron";
import { publishTikTokPost } from "@/lib/tiktok/publish";
import { decryptPageAccessToken } from "@/lib/security/tokens";
import { getCronSecret } from "@/lib/security/secrets";
import { logSecurityEvent } from "@/lib/security/audit";
import { cleanupPublishedMedia } from "@/lib/storage/cleanup";
import { pickPostsForCronRun } from "@/lib/publish/queue";
import type { TikTokAccount } from "@/lib/types";

export const maxDuration = 300;

const STALE_PROCESSING_MS = 15 * 60_000;
const POSTS_PER_RUN = 10;
const POSTS_FETCH_LIMIT = 50;

type PublishResult = {
  containerId?: string;
  mediaId: string;
  permalink?: string | null;
};

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = getCronSecret();

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const recovered = await recoverStaleProcessingPosts(supabase, STALE_PROCESSING_MS);
  const now = new Date().toISOString();

  const { data: posts, error } = await supabase
    .from("scheduled_posts")
    .select(
      "*, instagram_accounts(ig_user_id, page_access_token, auth_provider), tiktok_accounts(*)",
    )
    .eq("status", "pending")
    .lte("scheduled_at", now)
    .is("media_id", null)
    .order("scheduled_at", { ascending: true })
    .limit(POSTS_FETCH_LIMIT);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const postsToProcess = pickPostsForCronRun(posts ?? [], POSTS_PER_RUN);
  const results: Array<{ id: string; status: string; error?: string; skipped?: boolean }> = [];

  for (const post of postsToProcess) {
    const platform = post.platform ?? "instagram";

    if (post.media_id) {
      results.push({ id: post.id, status: post.status, skipped: true });
      continue;
    }

    let claimed = false;
    try {
      claimed = await claimPostForProcessing(supabase, post.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erro ao reservar post";
      results.push({ id: post.id, status: "error", error: message });
      continue;
    }

    if (!claimed) {
      results.push({ id: post.id, status: "skipped", skipped: true });
      continue;
    }

    try {
      await assertSafeToPublish(supabase, post.id);
    } catch (err) {
      if (err instanceof PublishGuardError) {
        results.push({ id: post.id, status: "blocked", skipped: true, error: err.message });
        continue;
      }
      const message = err instanceof Error ? err.message : "Erro na verificação de segurança";
      results.push({ id: post.id, status: "error", error: message });
      continue;
    }

    await logPublishEvent(supabase, post.id, "info", `Iniciando publicação (${platform})`);

    let publishResult: PublishResult | null = null;

    try {
      if (platform === "tiktok") {
        const account = post.tiktok_accounts as TikTokAccount | null;
        if (!account) {
          throw new Error("Conta TikTok não encontrada");
        }

        const result = await publishTikTokPost({
          account,
          mediaUrls: post.media_urls,
          caption: post.caption ?? undefined,
        });

        publishResult = {
          mediaId: result.postId,
          permalink: result.permalink,
        };

        await markPostPublished(supabase, post.id, {
          media_id: publishResult.mediaId,
          permalink: publishResult.permalink,
        });

        await logSecurityEvent({
          ownerId: account.owner_id,
          eventType: "tiktok_publish",
          resourceType: "scheduled_post",
          resourceId: post.id,
          metadata: { publishId: result.publishId, privacyLevel: result.privacyLevel },
        });

        await logPublishEvent(
          supabase,
          post.id,
          "success",
          `Publicado no TikTok: ${result.permalink ?? result.postId}`,
        );
        results.push({ id: post.id, status: "published" });
        continue;
      }

      const account = post.instagram_accounts as {
        ig_user_id: string;
        page_access_token: string;
        auth_provider?: "instagram" | "facebook" | null;
      } | null;

      if (!account) {
        throw new Error("Conta Instagram não encontrada");
      }

      const accessToken = decryptPageAccessToken(account.page_access_token);
      if (!accessToken) {
        throw new Error("Token da conta indisponível");
      }

      const result = await publishPost({
        igUserId: account.ig_user_id,
        token: accessToken,
        mediaType: post.media_type,
        mediaUrls: post.media_urls,
        caption: post.caption ?? undefined,
        provider: account.auth_provider === "facebook" ? "facebook" : "instagram",
      });

      publishResult = {
        containerId: result.containerId,
        mediaId: result.mediaId,
        permalink: result.permalink,
      };

      await markPostPublished(supabase, post.id, {
        container_id: publishResult.containerId,
        media_id: publishResult.mediaId,
        permalink: publishResult.permalink,
      });

      await logPublishEvent(
        supabase,
        post.id,
        "success",
        `Publicado: ${publishResult.permalink ?? publishResult.mediaId}`,
      );
      results.push({ id: post.id, status: "published" });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erro desconhecido";

      if (publishResult?.mediaId) {
        try {
          await markPostPublishCriticalFailure(
            supabase,
            post.id,
            publishResult.mediaId,
            `Publicado no ${platform}, mas falha ao finalizar registro: ${message}`,
          );
        } catch (criticalErr) {
          console.error(`[publish] critical failure handler error for ${post.id}:`, criticalErr);
        }
        results.push({ id: post.id, status: "critical", error: message });
        continue;
      }

      await markPostFailed(supabase, post.id, message);
      await logPublishEvent(supabase, post.id, "error", message);
      results.push({ id: post.id, status: "failed", error: message });
    }
  }

  let mediaCleanup = null;
  try {
    mediaCleanup = await cleanupPublishedMedia(supabase);
  } catch (err) {
    console.error("[publish] media cleanup error:", err);
    mediaCleanup = {
      error: err instanceof Error ? err.message : "Falha na limpeza de mídia",
    };
  }

  return NextResponse.json({
    recovered_stale_processing: recovered,
    processed: results.length,
    results,
    media_cleanup: mediaCleanup,
  });
}
