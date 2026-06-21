import type { SupabaseClient } from "@supabase/supabase-js";
import { getAppDateParts } from "@/lib/timezone";
import type { TikTokAccount } from "@/lib/types";

export type TikTokPendingPostSummary = {
  id: string;
  status: string;
  scheduled_at: string;
  localTime: string;
  caption: string | null;
  videoUrl: string | null;
  hasVideo: boolean;
};

function accountHandle(account: TikTokAccount) {
  const u = account.username ?? account.display_name ?? account.id.slice(0, 8);
  return u.startsWith("@") ? u : `@${u}`;
}

function formatLocalTime(scheduledAt: string) {
  const parts = getAppDateParts(new Date(scheduledAt));
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(parts.hour)}:${pad(parts.minute)}`;
}

function truncateCaption(caption: string | null | undefined, maxLength = 120) {
  if (!caption) return null;
  const trimmed = caption.trim();
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength)}…`;
}

export async function listTikTokNextPendingPosts(params: {
  supabase: SupabaseClient;
  account: TikTokAccount;
  limit?: number;
}) {
  const limit = Math.min(Math.max(params.limit ?? 10, 1), 50);

  const { data, error } = await params.supabase
    .from("scheduled_posts")
    .select("id, status, scheduled_at, caption, media_urls")
    .eq("platform", "tiktok")
    .eq("tiktok_account_id", params.account.id)
    .eq("status", "pending")
    .is("media_id", null)
    .order("scheduled_at", { ascending: true })
    .limit(limit);

  if (error) {
    throw new Error(error.message);
  }

  const posts: TikTokPendingPostSummary[] = (data ?? []).map((row) => {
    const videoUrl = Array.isArray(row.media_urls) ? (row.media_urls[0] ?? null) : null;
    return {
      id: row.id,
      status: row.status,
      scheduled_at: row.scheduled_at,
      localTime: formatLocalTime(row.scheduled_at),
      caption: truncateCaption(row.caption),
      videoUrl,
      hasVideo: Boolean(videoUrl),
    };
  });

  return {
    platform: "tiktok" as const,
    account: accountHandle(params.account),
    accountId: params.account.id,
    count: posts.length,
    posts,
    firstPostId: posts[0]?.id ?? null,
  };
}
