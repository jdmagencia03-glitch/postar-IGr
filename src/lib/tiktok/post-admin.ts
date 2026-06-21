import type { SupabaseClient } from "@supabase/supabase-js";
import { logPublishEvent } from "@/lib/publish/cron";

export type TikTokPostAdminStatus = {
  id: string;
  platform: string;
  status: string;
  scheduled_at: string;
  media_id: string | null;
  permalink: string | null;
  error_message: string | null;
  provider_publish_id: string | null;
  provider_status: string | null;
  retry_count: number | null;
  next_retry_at: string | null;
  tiktok_account_id: string | null;
  published: boolean;
  canResetToPending: boolean;
  resetBlockReason: string | null;
};

export async function getTikTokPostAdminStatus(
  supabase: SupabaseClient,
  postId: string,
  accountId?: string,
): Promise<TikTokPostAdminStatus | null> {
  const { data: post, error } = await supabase
    .from("scheduled_posts")
    .select(
      "id, platform, status, scheduled_at, media_id, permalink, error_message, provider_publish_id, provider_status, retry_count, next_retry_at, tiktok_account_id",
    )
    .eq("id", postId)
    .eq("platform", "tiktok")
    .maybeSingle();

  if (error || !post) return null;
  if (accountId && post.tiktok_account_id !== accountId) return null;

  const published = Boolean(post.media_id);
  let canResetToPending = false;
  let resetBlockReason: string | null = null;

  if (published) {
    resetBlockReason = "post_already_published_has_media_id";
  } else if (post.status === "published") {
    resetBlockReason = "post_status_published_without_media_id";
  } else if (post.status === "processing") {
    resetBlockReason = "post_currently_processing";
  } else if (["failed", "failed_persistent", "retrying"].includes(post.status)) {
    canResetToPending = true;
  } else if (post.status === "pending") {
    resetBlockReason = "already_pending";
  } else {
    resetBlockReason = `unsupported_status_${post.status}`;
  }

  return {
    id: post.id,
    platform: post.platform,
    status: post.status,
    scheduled_at: post.scheduled_at,
    media_id: post.media_id,
    permalink: post.permalink,
    error_message: post.error_message,
    provider_publish_id: post.provider_publish_id,
    provider_status: post.provider_status,
    retry_count: post.retry_count ?? null,
    next_retry_at: post.next_retry_at ?? null,
    tiktok_account_id: post.tiktok_account_id,
    published,
    canResetToPending,
    resetBlockReason,
  };
}

export async function resetTikTokPostToPending(
  supabase: SupabaseClient,
  postId: string,
  accountId?: string,
) {
  const current = await getTikTokPostAdminStatus(supabase, postId, accountId);
  if (!current) {
    throw new Error("Post TikTok não encontrado");
  }
  if (!current.canResetToPending) {
    throw new Error(current.resetBlockReason ?? "Post não pode voltar para pending");
  }

  const { data: updated, error } = await supabase
    .from("scheduled_posts")
    .update({
      status: "pending",
      error_message: null,
      retry_count: 0,
      next_retry_at: null,
      provider_publish_id: null,
      provider_status: null,
      provider_response: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", postId)
    .eq("platform", "tiktok")
    .is("media_id", null)
    .select("id, status, scheduled_at, error_message")
    .maybeSingle();

  if (error || !updated) {
    throw new Error(error?.message ?? "Falha ao resetar post para pending");
  }

  await logPublishEvent(
    supabase,
    postId,
    "info",
    "Admin reset: post TikTok voltou para pending após falha de publicação pública",
  );

  return {
    before: current,
    after: updated,
  };
}
