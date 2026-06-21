import type { SupabaseClient } from "@supabase/supabase-js";
import { parsePublishedFromSuccessLog } from "@/lib/instagram/duplicate-guard-trace";

export type PublishSuccessEvidence = {
  hasEvidence: boolean;
  reasons: Array<
    "instagram_media_id" | "permalink" | "status_published" | "success_log" | "same_media_success"
  >;
  successLogCount: number;
};

function isRealSuccessLogMessage(message: string) {
  if (!/publicado:/i.test(message)) return false;
  const parsed = parsePublishedFromSuccessLog(message);
  return Boolean(parsed.mediaId || parsed.permalink);
}

/** Evidência real de publicação — usada pelo duplicate guard. */
export async function getPublishSuccessEvidence(
  supabase: SupabaseClient,
  post: {
    id: string;
    status: string;
    media_id: string | null;
    permalink?: string | null;
    account_id?: string | null;
    media_urls?: string[] | null;
  },
): Promise<PublishSuccessEvidence> {
  const reasons = new Set<PublishSuccessEvidence["reasons"][number]>();

  if (post.media_id) reasons.add("instagram_media_id");
  if (post.permalink) reasons.add("permalink");
  if (post.status === "published") reasons.add("status_published");

  const { data: successLogs } = await supabase
    .from("publish_logs")
    .select("message")
    .eq("post_id", post.id)
    .eq("level", "success");

  const realSuccessLogs = (successLogs ?? []).filter((row) => isRealSuccessLogMessage(row.message));
  if (realSuccessLogs.length > 0) reasons.add("success_log");

  const videoUrl = post.media_urls?.[0];
  if (videoUrl && post.account_id) {
    const { data: sameUrlPosts } = await supabase
      .from("scheduled_posts")
      .select("id")
      .eq("account_id", post.account_id)
      .contains("media_urls", [videoUrl])
      .neq("id", post.id)
      .eq("status", "published")
      .limit(5);

    if ((sameUrlPosts ?? []).length > 0) {
      reasons.add("same_media_success");
    }
  }

  return {
    hasEvidence: reasons.size > 0,
    reasons: [...reasons],
    successLogCount: realSuccessLogs.length,
  };
}
