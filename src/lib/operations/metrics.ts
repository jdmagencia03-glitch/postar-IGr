import { isToday, isWithinInterval, parseISO, startOfDay, subDays } from "date-fns";
import { CONTENT_TYPE_LABELS } from "@/lib/content-types";
import type { ContentType, PostStatus, ScheduledPost, SocialPlatform } from "@/lib/types";

export interface StatusBreakdown {
  pending: number;
  processing: number;
  published: number;
  failed: number;
  retrying: number;
  failedPersistent: number;
  cancelled: number;
}

export interface PublicationMetrics {
  publishedToday: number;
  pending: number;
  failed: number;
  retrying: number;
  cancelled: number;
  successRate: number;
  errorRate: number;
  totalByPlatform: Record<SocialPlatform, number>;
  totalByContentType: Record<string, number>;
  nextScheduled: ScheduledPost | null;
  lastPublished: ScheduledPost | null;
  lastError: { post: ScheduledPost; at: string } | null;
  breakdown: StatusBreakdown;
}

export interface PlatformMetrics {
  platform: SocialPlatform | "multiplatform";
  label: string;
  published: number;
  pending: number;
  failed: number;
  retrying: number;
  cancelled: number;
  successRate: number;
  reels?: number;
  stories?: number;
  posts?: number;
  videos?: number;
}

export interface ContentTypeMetricsRow {
  contentType: ContentType;
  label: string;
  published: number;
  pending: number;
  failed: number;
  retrying: number;
  cancelled: number;
  successRate: number;
  nextScheduled: string | null;
}

export interface MultiplatformGroupMetrics {
  totalGroups: number;
  completeGroups: number;
  partialGroups: number;
  errorGroups: number;
  retryGroups: number;
  pendingGroups: number;
}

function isFailed(status: PostStatus) {
  return status === "failed" || status === "failed_persistent";
}

function isPending(status: PostStatus) {
  return status === "pending" || status === "retrying";
}

function successRate(published: number, total: number) {
  if (!total) return 0;
  return Math.round((published / total) * 100);
}

function resolveContentType(post: ScheduledPost): ContentType {
  return (post.content_type ?? "reel") as ContentType;
}

export function computeStatusBreakdown(posts: ScheduledPost[]): StatusBreakdown {
  return {
    pending: posts.filter((p) => p.status === "pending").length,
    processing: posts.filter((p) => p.status === "processing").length,
    published: posts.filter((p) => p.status === "published").length,
    failed: posts.filter((p) => p.status === "failed").length,
    retrying: posts.filter((p) => p.status === "retrying").length,
    failedPersistent: posts.filter((p) => p.status === "failed_persistent").length,
    cancelled: posts.filter((p) => p.status === "cancelled").length,
  };
}

export function computePublicationMetrics(
  posts: ScheduledPost[],
  now = new Date(),
): PublicationMetrics {
  const breakdown = computeStatusBreakdown(posts);
  const publishedToday = posts.filter(
    (p) => p.status === "published" && p.published_at && isToday(parseISO(p.published_at)),
  ).length;

  const terminal = posts.filter(
    (p) => p.status === "published" || isFailed(p.status) || p.status === "cancelled",
  );
  const published = breakdown.published;
  const failedTotal = breakdown.failed + breakdown.failedPersistent + breakdown.retrying;

  const totalByPlatform: Record<SocialPlatform, number> = { instagram: 0, tiktok: 0 };
  const totalByContentType: Record<string, number> = {};

  for (const post of posts) {
    const platform = post.platform ?? "instagram";
    totalByPlatform[platform] = (totalByPlatform[platform] ?? 0) + 1;
    const ct = resolveContentType(post);
    totalByContentType[ct] = (totalByContentType[ct] ?? 0) + 1;
  }

  const nextScheduled =
    posts
      .filter((p) => isPending(p.status) || p.status === "processing")
      .sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime())[0] ??
    null;

  const lastPublished =
    posts
      .filter((p) => p.status === "published" && p.published_at)
      .sort((a, b) => new Date(b.published_at!).getTime() - new Date(a.published_at!).getTime())[0] ??
    null;

  const lastErrorPost = posts
    .filter((p) => p.error_message)
    .sort((a, b) => new Date(b.scheduled_at).getTime() - new Date(a.scheduled_at).getTime())[0];

  return {
    publishedToday,
    pending: breakdown.pending + breakdown.retrying,
    failed: breakdown.failed + breakdown.failedPersistent,
    retrying: breakdown.retrying,
    cancelled: breakdown.cancelled,
    successRate: successRate(published, terminal.length),
    errorRate: terminal.length ? Math.round((failedTotal / terminal.length) * 100) : 0,
    totalByPlatform,
    totalByContentType,
    nextScheduled,
    lastPublished,
    lastError: lastErrorPost
      ? { post: lastErrorPost, at: lastErrorPost.scheduled_at }
      : null,
    breakdown,
  };
}

export function computePlatformMetrics(posts: ScheduledPost[]): PlatformMetrics[] {
  const platforms: Array<{ key: SocialPlatform; label: string }> = [
    { key: "instagram", label: "Instagram" },
    { key: "tiktok", label: "TikTok" },
  ];

  const rows: PlatformMetrics[] = platforms.map(({ key, label }) => {
    const scoped = posts.filter((p) => (p.platform ?? "instagram") === key);
    const published = scoped.filter((p) => p.status === "published").length;
    const pending = scoped.filter((p) => isPending(p.status)).length;
    const failed = scoped.filter((p) => isFailed(p.status)).length;
    const retrying = scoped.filter((p) => p.status === "retrying").length;
    const cancelled = scoped.filter((p) => p.status === "cancelled").length;
    const terminal = scoped.filter(
      (p) => p.status === "published" || isFailed(p.status) || p.status === "cancelled",
    );

    return {
      platform: key,
      label,
      published,
      pending,
      failed,
      retrying,
      cancelled,
      successRate: successRate(published, terminal.length),
      reels: scoped.filter((p) => resolveContentType(p) === "reel" && p.status === "published").length,
      stories: scoped.filter((p) => resolveContentType(p) === "story" && p.status === "published").length,
      posts: scoped.filter((p) => resolveContentType(p) === "post" && p.status === "published").length,
      videos:
        key === "tiktok"
          ? scoped.filter((p) => p.status === "published").length
          : undefined,
    };
  });

  const groupIds = new Set(
    posts.filter((p) => p.parent_publish_group_id).map((p) => p.parent_publish_group_id!),
  );
  const multiPosts = posts.filter((p) => p.parent_publish_group_id);
  const multiPublished = multiPosts.filter((p) => p.status === "published").length;
  const multiPending = multiPosts.filter((p) => isPending(p.status)).length;
  const multiFailed = multiPosts.filter((p) => isFailed(p.status)).length;
  const multiRetrying = multiPosts.filter((p) => p.status === "retrying").length;
  const multiTerminal = multiPosts.filter(
    (p) => p.status === "published" || isFailed(p.status),
  );

  rows.push({
    platform: "multiplatform",
    label: "Multiplataforma",
    published: multiPublished,
    pending: multiPending,
    failed: multiFailed,
    retrying: multiRetrying,
    cancelled: 0,
    successRate: successRate(multiPublished, multiTerminal.length),
    reels: groupIds.size,
    stories: 0,
    posts: 0,
    videos: undefined,
  });

  return rows;
}

export function computeContentTypeMetrics(posts: ScheduledPost[]): ContentTypeMetricsRow[] {
  const types: ContentType[] = ["reel", "post", "story", "tiktok_video"];

  return types.map((contentType) => {
    const scoped = posts.filter((p) => resolveContentType(p) === contentType);
    const published = scoped.filter((p) => p.status === "published").length;
    const pending = scoped.filter((p) => isPending(p.status)).length;
    const failed = scoped.filter((p) => isFailed(p.status)).length;
    const retrying = scoped.filter((p) => p.status === "retrying").length;
    const cancelled = scoped.filter((p) => p.status === "cancelled").length;
    const terminal = scoped.filter(
      (p) => p.status === "published" || isFailed(p.status) || p.status === "cancelled",
    );

    const nextScheduled =
      scoped
        .filter((p) => isPending(p.status))
        .sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime())[0]
        ?.scheduled_at ?? null;

    return {
      contentType,
      label: CONTENT_TYPE_LABELS[contentType],
      published,
      pending,
      failed,
      retrying,
      cancelled,
      successRate: successRate(published, terminal.length),
      nextScheduled,
    };
  });
}

export function computeAccountWindowMetrics(
  posts: ScheduledPost[],
  accountId: string,
  platform: SocialPlatform,
  now = new Date(),
) {
  const scoped = posts.filter((p) => {
    if (platform === "tiktok") return p.tiktok_account_id === accountId;
    return p.account_id === accountId;
  });

  const last7Start = startOfDay(subDays(now, 7));
  const last30Start = startOfDay(subDays(now, 30));

  const publishedLast7Days = scoped.filter(
    (p) =>
      p.status === "published" &&
      p.published_at &&
      isWithinInterval(parseISO(p.published_at), { start: last7Start, end: now }),
  ).length;

  const publishedLast30Days = scoped.filter(
    (p) =>
      p.status === "published" &&
      p.published_at &&
      isWithinInterval(parseISO(p.published_at), { start: last30Start, end: now }),
  ).length;

  const published = scoped.filter((p) => p.status === "published").length;
  const failed = scoped.filter((p) => isFailed(p.status)).length;
  const terminal = scoped.filter(
    (p) => p.status === "published" || isFailed(p.status) || p.status === "cancelled",
  );

  const typeCounts = new Map<ContentType, number>();
  for (const post of scoped.filter((p) => p.status === "published")) {
    const ct = resolveContentType(post);
    typeCounts.set(ct, (typeCounts.get(ct) ?? 0) + 1);
  }
  const topContentType =
    [...typeCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  return {
    publishedLast7Days,
    publishedLast30Days,
    failedPersistent: scoped.filter((p) => p.status === "failed_persistent").length,
    successRate: successRate(published, terminal.length),
    topContentType,
  };
}

export function computeMultiplatformGroupMetrics(posts: ScheduledPost[]): MultiplatformGroupMetrics {
  const byGroup = new Map<string, ScheduledPost[]>();
  for (const post of posts) {
    if (!post.parent_publish_group_id) continue;
    const bucket = byGroup.get(post.parent_publish_group_id) ?? [];
    bucket.push(post);
    byGroup.set(post.parent_publish_group_id, bucket);
  }

  const groups = [...byGroup.values()].filter((items) => items.length > 1);
  let completeGroups = 0;
  let partialGroups = 0;
  let errorGroups = 0;
  let retryGroups = 0;
  let pendingGroups = 0;

  for (const items of groups) {
    const allPublished = items.every((p) => p.status === "published");
    const anyFailed = items.some((p) => isFailed(p.status));
    const anyRetry = items.some((p) => p.status === "retrying");
    const anyPending = items.some((p) => isPending(p.status) || p.status === "processing");

    if (allPublished) completeGroups++;
    else if (anyFailed && !anyRetry) errorGroups++;
    else if (anyRetry) retryGroups++;
    else if (items.some((p) => p.status === "published")) partialGroups++;
    else if (anyPending) pendingGroups++;
  }

  return {
    totalGroups: groups.length,
    completeGroups,
    partialGroups,
    errorGroups,
    retryGroups,
    pendingGroups,
  };
}
