import type { SupabaseClient } from "@supabase/supabase-js";
import {
  MEDIA_INTEGRITY_PAUSE_THRESHOLD,
  MEDIA_INTEGRITY_PAUSE_WINDOW_MS,
  MEDIA_MISSING_LOG,
} from "@/lib/media/constants";
import { validateVideoMediaUrl } from "@/lib/storage/media-url-validation";
import { logPublishEvent } from "@/lib/publish/cron";
import { reportClientOperationalError } from "@/lib/operations/operational-errors";

export type PrePublishMediaCheck =
  | { ok: true }
  | {
      ok: false;
      code: string;
      message: string;
      action: "reupload_required";
    };

export async function validatePostMediaBeforePublish(params: {
  supabase: SupabaseClient;
  postId: string;
  mediaUrls: string[];
  contentType?: string | null;
}): Promise<PrePublishMediaCheck> {
  const videoUrl = params.mediaUrls[0];
  if (!videoUrl) {
    return {
      ok: false,
      code: "missing_video_url",
      message: "Post sem URL de vídeo.",
      action: "reupload_required",
    };
  }

  const isVideo =
    params.contentType !== "story" ||
    /\.(mp4|mov|webm)(\?|$)/i.test(videoUrl);

  if (!isVideo) {
    return { ok: true };
  }

  const validation = await validateVideoMediaUrl({
    supabase: params.supabase,
    videoUrl,
    checkStorage: true,
  });

  if (!validation.ok) {
    return {
      ok: false,
      code: validation.code,
      message: validation.message,
      action: "reupload_required",
    };
  }

  return { ok: true };
}

export async function markPostNeedsMedia(
  supabase: SupabaseClient,
  postId: string,
  message: string,
  code = "video_storage_object_missing",
) {
  const { data: post } = await supabase
    .from("scheduled_posts")
    .select("retry_count, media_asset_id")
    .eq("id", postId)
    .maybeSingle();

  await supabase
    .from("scheduled_posts")
    .update({
      status: "needs_media",
      error_message: `${code}: ${message}`,
      updated_at: new Date().toISOString(),
    })
    .eq("id", postId);

  if (post?.media_asset_id) {
    await supabase
      .from("media_assets")
      .update({
        status: "missing",
        validation_status: "invalid",
        last_validation_error: message,
        last_validation_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", post.media_asset_id);
  }

  await logPublishEvent(
    supabase,
    postId,
    "error",
    `${MEDIA_MISSING_LOG}: ${message} (retry_count preserved: ${post?.retry_count ?? 0})`,
  );
}

export async function maybePauseAccountForMediaIntegrity(params: {
  supabase: SupabaseClient;
  ownerId: string;
  accountId: string;
  platform: "instagram";
}) {
  const since = new Date(Date.now() - MEDIA_INTEGRITY_PAUSE_WINDOW_MS).toISOString();

  const { count } = await params.supabase
    .from("scheduled_posts")
    .select("id", { count: "exact", head: true })
    .eq("account_id", params.accountId)
    .eq("status", "needs_media")
    .gte("updated_at", since);

  if ((count ?? 0) < MEDIA_INTEGRITY_PAUSE_THRESHOLD) {
    return { paused: false, count: count ?? 0 };
  }

  await params.supabase
    .from("instagram_accounts")
    .update({
      publishing_paused: true,
      pause_reason: "media_integrity_failed",
      updated_at: new Date().toISOString(),
    })
    .eq("id", params.accountId);

  console.info(
    "[media-integrity-auto-pause]",
    JSON.stringify({
      ownerId: params.ownerId,
      accountId: params.accountId,
      needsMediaCount: count,
    }),
  );

  return { paused: true, count: count ?? 0 };
}

export async function handleMissingMediaOnPublish(params: {
  supabase: SupabaseClient;
  ownerId: string;
  postId: string;
  accountId: string | null;
  platform: "instagram" | "tiktok";
  message: string;
  code?: string;
}) {
  if (params.platform !== "instagram") {
    return;
  }

  await markPostNeedsMedia(params.supabase, params.postId, params.message, params.code);

  try {
    await reportClientOperationalError(params.supabase, params.ownerId, {
      errorType: "storage_object_missing",
      title: "Vídeo ausente no Storage",
      message: params.message,
      probableCause: "O objeto de mídia não existe ou não está acessível no Supabase Storage.",
      recommendedAction: "Reenvie o vídeo antes de tentar publicar novamente.",
      metadata: {
        code: params.code ?? "video_storage_object_missing",
        accountId: params.accountId,
        postId: params.postId,
      },
    });
  } catch {
    // ignore
  }

  if (params.accountId) {
    await maybePauseAccountForMediaIntegrity({
      supabase: params.supabase,
      ownerId: params.ownerId,
      accountId: params.accountId,
      platform: "instagram",
    });
  }
}
