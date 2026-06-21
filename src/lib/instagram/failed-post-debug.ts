import type { SupabaseClient } from "@supabase/supabase-js";
import { buildDuplicateGuardTrace } from "@/lib/instagram/duplicate-guard-trace";
import { getAccountAccessToken } from "@/lib/accounts";
import { getInstagramAccountForAdmin } from "@/lib/instagram/admin-gate";
import { probeVideoUrl, runFfprobeIfAvailable } from "@/lib/instagram/video-probe";
import { fetchInstagramContainerStatus } from "@/lib/meta/instagram-container";

export type ProbableCause =
  | "instagram_video_url_inaccessible"
  | "instagram_unsupported_video_format"
  | "instagram_container_processing_error"
  | "instagram_polling_bug"
  | "instagram_retry_reused_bad_container"
  | "unknown";

function extractFromLogs(logs: Array<{ message: string }>) {
  let lastGraphApiError: string | null = null;
  let fbtraceId: string | null = null;
  let instagramContainerId: string | null = null;

  for (const log of logs) {
    const msg = log.message;
    const fbMatch = msg.match(/fbtrace_id=([^\s|]+)/);
    if (fbMatch) fbtraceId = fbMatch[1];
    const containerMatch = msg.match(/container=([0-9]+)/);
    if (containerMatch) instagramContainerId = containerMatch[1];
    if (msg.includes("Graph:")) {
      lastGraphApiError = msg.split("Graph:")[1]?.split("|")[0]?.trim() ?? msg;
    } else if (msg.includes("Falha persistente") || msg.includes("Erro:")) {
      lastGraphApiError = msg;
    }
  }

  return { lastGraphApiError, fbtraceId, instagramContainerId };
}

function inferProbableCause(params: {
  videoProbe: Awaited<ReturnType<typeof probeVideoUrl>>;
  lastContainerStatus: string;
  errorMessage: string | null;
  retryCount: number;
  hasContainerId: boolean;
}): ProbableCause {
  if (!params.videoProbe.videoUrlAccessible) {
    return "instagram_video_url_inaccessible";
  }
  if (
    params.videoProbe.looksLikeHtml ||
    params.videoProbe.zeroBytes ||
    (params.videoProbe.contentType && !params.videoProbe.contentType.toLowerCase().includes("video/"))
  ) {
    return "instagram_unsupported_video_format";
  }
  if (params.errorMessage?.includes("Timeout aguardando processamento")) {
    return "instagram_polling_bug";
  }
  if (params.lastContainerStatus === "ERROR") {
    return "instagram_container_processing_error";
  }
  if (params.hasContainerId && params.retryCount > 0) {
    return "instagram_retry_reused_bad_container";
  }
  if (params.errorMessage?.includes("Processamento da mídia falhou")) {
    return "instagram_container_processing_error";
  }
  return "unknown";
}

export async function buildInstagramFailedPostDebug(params: {
  supabase: SupabaseClient;
  ownerId: string;
  accountId: string;
  limit?: number;
}) {
  const account = await getInstagramAccountForAdmin(
    params.supabase,
    params.ownerId,
    params.accountId,
  );

  if (!account) {
    return { ok: false as const, error: "account_not_found" as const };
  }

  const accessToken = getAccountAccessToken(account);
  const provider = account.auth_provider === "facebook" ? "facebook" : "instagram";
  const limit = Math.min(Math.max(params.limit ?? 20, 1), 50);

  const { data: posts, error: postsError } = await params.supabase
    .from("scheduled_posts")
    .select(
      "id, status, scheduled_at, retry_count, caption, media_urls, container_id, media_id, permalink, error_message",
    )
    .eq("account_id", params.accountId)
    .in("status", ["failed", "failed_persistent", "retrying"])
    .order("scheduled_at", { ascending: false })
    .limit(limit);

  if (postsError) {
    throw new Error(postsError.message);
  }

  const postIds = (posts ?? []).map((post) => post.id);
  const logsByPost = new Map<string, Array<{ message: string }>>();

  if (postIds.length > 0) {
    const { data: logs } = await params.supabase
      .from("publish_logs")
      .select("post_id, message")
      .in("post_id", postIds)
      .order("created_at", { ascending: false });

    for (const log of logs ?? []) {
      const list = logsByPost.get(log.post_id) ?? [];
      list.push({ message: log.message });
      logsByPost.set(log.post_id, list);
    }
  }

  const items = [];

  for (const post of posts ?? []) {
    const videoUrl = post.media_urls?.[0] ?? null;
    const videoProbe = await probeVideoUrl(videoUrl);
    const ffprobe =
      videoProbe.videoUrlAccessible && videoUrl ? await runFfprobeIfAvailable(videoUrl) : null;
    const logExtract = extractFromLogs(logsByPost.get(post.id) ?? []);

    const containerId = post.container_id ?? logExtract.instagramContainerId;
    let lastContainerStatus: "ERROR" | "IN_PROGRESS" | "FINISHED" | "UNKNOWN" = "UNKNOWN";
    let lastGraphApiError = logExtract.lastGraphApiError ?? post.error_message;
    let fbtraceId = logExtract.fbtraceId;

    if (containerId && accessToken) {
      try {
        const snapshot = await fetchInstagramContainerStatus({
          containerId,
          token: accessToken,
          provider,
        });
        lastContainerStatus = snapshot.lastContainerStatus;
        if (snapshot.graphError) lastGraphApiError = snapshot.graphError;
        if (snapshot.fbtraceId) fbtraceId = snapshot.fbtraceId;
      } catch {
        // consulta live opcional
      }
    }

    const probableCause = inferProbableCause({
      videoProbe,
      lastContainerStatus,
      errorMessage: post.error_message,
      retryCount: post.retry_count ?? 0,
      hasContainerId: Boolean(containerId),
    });

    const duplicateGuardTrace = await buildDuplicateGuardTrace({
      supabase: params.supabase,
      post: {
        id: post.id,
        account_id: params.accountId,
        caption: post.caption,
        media_urls: post.media_urls,
        container_id: post.container_id,
        media_id: post.media_id,
        permalink: post.permalink,
        error_message: post.error_message,
        status: post.status,
      },
    });

    items.push({
      postId: post.id,
      status: post.status,
      scheduledAt: post.scheduled_at,
      retryCount: post.retry_count ?? 0,
      caption: post.caption,
      videoUrl,
      hasVideo: videoProbe.hasVideo,
      videoUrlAccessible: videoProbe.videoUrlAccessible,
      httpStatus: videoProbe.httpStatus,
      contentType: videoProbe.contentType,
      contentLength: videoProbe.contentLength,
      isPublicUrl: videoProbe.isPublicUrl,
      instagramContainerId: containerId,
      instagramMediaId: post.media_id,
      lastContainerStatus,
      lastGraphApiError,
      fbtraceId,
      retryReusedOldContainer: false,
      probableCause,
      ffprobe,
      duplicateGuardTrace,
    });
  }

  return {
    ok: true as const,
    ownerId: params.ownerId,
    accountId: params.accountId,
    count: items.length,
    posts: items,
  };
}
