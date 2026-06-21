import { createHash } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export type DuplicateGuardRecommendedAction =
  | "mark_as_published"
  | "cancel_as_duplicate"
  | "manual_review"
  | "safe_retry_possible";

export type MatchedSuccessLog = {
  id: string;
  postId: string;
  level: string;
  message: string;
  createdAt: string;
  parsedPermalink: string | null;
  parsedMediaId: string | null;
};

export type MatchedPublishAttempt = {
  id: string;
  postId: string;
  level: string;
  message: string;
  createdAt: string;
};

export type DuplicateGuardTrace = {
  blockedByDuplicateGuard: boolean;
  matchedSuccessLogs: MatchedSuccessLog[];
  matchedPublishAttempts: MatchedPublishAttempt[];
  matchedBy: Array<
    "post_id" | "video_url" | "container_id" | "instagram_media_id" | "caption_hash"
  >;
  hasExactPostSuccessLog: boolean;
  hasSameMediaSuccessLog: boolean;
  hasInstagramMediaId: boolean;
  instagramMediaId: string | null;
  instagramPermalink: string | null;
  sameMediaSuccessPostIds: string[];
  recommendedAction: DuplicateGuardRecommendedAction;
  guardErrorMessages: string[];
};

const DUPLICATE_GUARD_PHRASES = [
  "log de sucesso existente",
  "republicação bloqueada",
  "publicação anterior detectada nos logs",
  "publicação detectada nos logs",
];

export function isDuplicateGuardErrorMessage(message: string | null | undefined) {
  if (!message) return false;
  const lower = message.toLowerCase();
  return DUPLICATE_GUARD_PHRASES.some((phrase) => lower.includes(phrase));
}

export function captionHash(caption: string | null | undefined) {
  if (!caption?.trim()) return null;
  return createHash("sha256").update(caption.trim().toLowerCase()).digest("hex").slice(0, 16);
}

export function parsePublishedFromSuccessLog(message: string) {
  const match = message.match(/Publicado:\s*(.+)$/i);
  if (!match) return { permalink: null as string | null, mediaId: null as string | null };
  const value = match[1].trim();
  if (/^https?:\/\//i.test(value)) {
    return { permalink: value, mediaId: null };
  }
  if (/^\d+$/.test(value)) {
    return { permalink: null, mediaId: value };
  }
  return { permalink: value, mediaId: null };
}

function isRealSuccessLogMessage(message: string) {
  if (!/publicado:/i.test(message)) return false;
  const parsed = parsePublishedFromSuccessLog(message);
  return Boolean(parsed.mediaId || parsed.permalink);
}

function mapSuccessLog(row: {
  id: string;
  post_id: string;
  level: string;
  message: string;
  created_at: string;
}): MatchedSuccessLog {
  const parsed = parsePublishedFromSuccessLog(row.message);
  return {
    id: row.id,
    postId: row.post_id,
    level: row.level,
    message: row.message,
    createdAt: row.created_at,
    parsedPermalink: parsed.permalink,
    parsedMediaId: parsed.mediaId,
  };
}

export async function buildDuplicateGuardTrace(params: {
  supabase: SupabaseClient;
  post: {
    id: string;
    account_id: string | null;
    caption: string | null;
    media_urls: string[] | null;
    container_id: string | null;
    media_id: string | null;
    permalink: string | null;
    error_message: string | null;
    status: string;
  };
}) {
  const videoUrl = params.post.media_urls?.[0] ?? null;
  const postCaptionHash = captionHash(params.post.caption);
  const matchedBy = new Set<DuplicateGuardTrace["matchedBy"][number]>();
  const guardErrorMessages: string[] = [];

  if (isDuplicateGuardErrorMessage(params.post.error_message)) {
    guardErrorMessages.push(params.post.error_message!);
  }

  const { data: publishLogs } = await params.supabase
    .from("publish_logs")
    .select("id, post_id, level, message, created_at")
    .eq("post_id", params.post.id)
    .order("created_at", { ascending: false })
    .limit(100);

  const matchedPublishAttempts: MatchedPublishAttempt[] = (publishLogs ?? []).map((row) => ({
    id: row.id,
    postId: row.post_id,
    level: row.level,
    message: row.message,
    createdAt: row.created_at,
  }));

  const exactSuccessRows = (publishLogs ?? []).filter(
    (row) => row.level === "success" && isRealSuccessLogMessage(row.message),
  );
  const matchedSuccessLogs = exactSuccessRows.map(mapSuccessLog);
  const hasExactPostSuccessLog = matchedSuccessLogs.length > 0;

  if (hasExactPostSuccessLog) {
    matchedBy.add("post_id");
  }

  const hasInstagramMediaId = Boolean(params.post.media_id);
  if (hasInstagramMediaId) {
    matchedBy.add("instagram_media_id");
  }

  if (params.post.container_id) {
    matchedBy.add("container_id");
  }

  if (params.post.permalink) {
    matchedBy.add("instagram_media_id");
  }

  let hasSameMediaSuccessLog = false;
  const sameMediaSuccessPostIds: string[] = [];

  if (videoUrl && params.post.account_id) {
    const { data: sameUrlPosts } = await params.supabase
      .from("scheduled_posts")
      .select("id, media_urls, status, media_id, permalink")
      .eq("account_id", params.post.account_id)
      .contains("media_urls", [videoUrl])
      .neq("id", params.post.id)
      .limit(50);

    for (const other of sameUrlPosts ?? []) {
      const { count } = await params.supabase
        .from("publish_logs")
        .select("id", { count: "exact", head: true })
        .eq("post_id", other.id)
        .eq("level", "success");

      if ((count ?? 0) > 0) {
        hasSameMediaSuccessLog = true;
        sameMediaSuccessPostIds.push(other.id);
        matchedBy.add("video_url");
      }
    }
  }

  if (postCaptionHash && params.post.account_id) {
    const { data: captionMatches } = await params.supabase
      .from("scheduled_posts")
      .select("id, caption, status")
      .eq("account_id", params.post.account_id)
      .eq("status", "published")
      .neq("id", params.post.id)
      .not("caption", "is", null)
      .limit(100);

    for (const row of captionMatches ?? []) {
      if (captionHash(row.caption) === postCaptionHash) {
        matchedBy.add("caption_hash");
        break;
      }
    }
  }

  if (params.post.container_id && params.post.account_id) {
    const { data: containerMatches } = await params.supabase
      .from("scheduled_posts")
      .select("id")
      .eq("account_id", params.post.account_id)
      .eq("container_id", params.post.container_id)
      .neq("id", params.post.id)
      .limit(5);

    if ((containerMatches ?? []).length > 0) {
      matchedBy.add("container_id");
    }
  }

  const hasPermalink = Boolean(params.post.permalink);
  const blockedByDuplicateGuard =
    hasExactPostSuccessLog ||
    hasInstagramMediaId ||
    hasPermalink ||
    hasSameMediaSuccessLog;

  let recommendedAction: DuplicateGuardRecommendedAction = "manual_review";

  if (hasExactPostSuccessLog) {
    const parsed = matchedSuccessLogs[0];
    if (hasInstagramMediaId || parsed?.parsedMediaId || parsed?.parsedPermalink) {
      recommendedAction = "mark_as_published";
    } else {
      recommendedAction = "manual_review";
    }
  } else if (hasSameMediaSuccessLog) {
    recommendedAction = "cancel_as_duplicate";
  } else if (!blockedByDuplicateGuard) {
    recommendedAction = "safe_retry_possible";
  }

  const parsedFromLog = matchedSuccessLogs[0];
  const instagramMediaId =
    params.post.media_id ?? parsedFromLog?.parsedMediaId ?? null;
  const instagramPermalink =
    params.post.permalink ?? parsedFromLog?.parsedPermalink ?? null;

  return {
    blockedByDuplicateGuard,
    matchedSuccessLogs,
    matchedPublishAttempts,
    matchedBy: [...matchedBy],
    hasExactPostSuccessLog,
    hasSameMediaSuccessLog,
    hasInstagramMediaId,
    instagramMediaId,
    instagramPermalink,
    sameMediaSuccessPostIds,
    recommendedAction,
    guardErrorMessages,
  } satisfies DuplicateGuardTrace;
}

export async function resolveOperationalErrorsForPost(
  supabase: SupabaseClient,
  ownerId: string,
  postId: string,
  resolutionNote?: string,
) {
  const now = new Date().toISOString();
  const { data: rows } = await supabase
    .from("operational_errors")
    .select("id, metadata")
    .eq("owner_id", ownerId)
    .eq("scheduled_post_id", postId)
    .in("status", ["open", "investigating", "auto_retrying", "needs_user_action"]);

  for (const row of rows ?? []) {
    const prevMeta = (row.metadata as Record<string, unknown>) ?? {};
    await supabase
      .from("operational_errors")
      .update({
        status: "resolved",
        resolved_at: now,
        updated_at: now,
        metadata: {
          ...prevMeta,
          resolutionNote: resolutionNote ?? "resolved_by_admin",
        },
      })
      .eq("id", row.id);
  }
}
