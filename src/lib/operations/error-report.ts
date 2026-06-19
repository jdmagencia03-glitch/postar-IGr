import { isToday, isWithinInterval, parseISO, startOfDay, subDays } from "date-fns";
import { CONTENT_TYPE_LABELS } from "@/lib/content-types";
import { getPostAccountUsername } from "@/lib/posts";
import type { ContentType, PostStatus, ScheduledPost, SocialPlatform } from "@/lib/types";

export interface ErrorReportItem {
  postId: string;
  accountId: string;
  accountUsername: string;
  platform: SocialPlatform;
  contentType: ContentType;
  contentTypeLabel: string;
  status: PostStatus;
  errorMessage: string;
  scheduledAt: string;
  retryCount: number;
  nextRetryAt: string | null;
  recommendedAction: string;
  actionHref?: string;
  mediaFilename: string | null;
}

export interface ErrorReportSummary {
  errorsToday: number;
  errorsLast7Days: number;
  byAccount: Array<{ accountId: string; username: string; count: number }>;
  byPlatform: Record<SocialPlatform, number>;
  byContentType: Record<string, number>;
  topErrors: Array<{ message: string; count: number }>;
  failedPersistent: number;
  stuckProcessing: number;
  retryExhausted: number;
  items: ErrorReportItem[];
}

function isFailed(status: PostStatus) {
  return status === "failed" || status === "failed_persistent";
}

function normalizeError(message: string) {
  return message.trim().slice(0, 120);
}

function recommendAction(post: ScheduledPost): { action: string; href?: string } {
  const msg = (post.error_message ?? "").toLowerCase();
  const accountId = post.platform === "tiktok" ? post.tiktok_account_id : post.account_id;

  if (msg.includes("token") || msg.includes("expir") || msg.includes("permission") || msg.includes("oauth")) {
    const href =
      post.platform === "tiktok"
        ? `/api/tiktok/connect?next=/dashboard/accounts/${accountId}/diagnostics?platform=tiktok&add_account=1`
        : `/api/auth/meta?next=/dashboard/accounts/${accountId}/diagnostics?platform=instagram`;
    return { action: "Reconectar conta", href };
  }

  if (post.status === "failed_persistent") {
    return { action: "Retry manual ou reagendar", href: `/dashboard/posts/${post.id}` };
  }

  if (post.status === "retrying") {
    return { action: "Aguardar próximo retry", href: `/dashboard/posts/${post.id}` };
  }

  if (post.status === "processing") {
    return { action: "Verificar se está preso", href: `/dashboard/posts/${post.id}` };
  }

  return { action: "Tentar novamente", href: `/dashboard/posts/${post.id}` };
}

function errorPosts(posts: ScheduledPost[]) {
  return posts.filter(
    (p) =>
      isFailed(p.status) ||
      p.status === "retrying" ||
      (p.status === "processing" && p.error_message),
  );
}

export function buildErrorReport(posts: ScheduledPost[], now = new Date()): ErrorReportSummary {
  const errors = errorPosts(posts);
  const last7Start = startOfDay(subDays(now, 7));

  const errorsToday = errors.filter((p) => isToday(parseISO(p.scheduled_at))).length;
  const errorsLast7Days = errors.filter((p) =>
    isWithinInterval(parseISO(p.scheduled_at), { start: last7Start, end: now }),
  ).length;

  const accountCounts = new Map<string, { username: string; count: number }>();
  const platformCounts: Record<SocialPlatform, number> = { instagram: 0, tiktok: 0 };
  const typeCounts = new Map<string, number>();
  const messageCounts = new Map<string, number>();

  for (const post of errors) {
    const accountId = (post.platform === "tiktok" ? post.tiktok_account_id : post.account_id) ?? "";
    const username = getPostAccountUsername(post);
    const existing = accountCounts.get(accountId) ?? { username, count: 0 };
    existing.count++;
    accountCounts.set(accountId, existing);

    const platform = post.platform ?? "instagram";
    platformCounts[platform]++;

    const ct = post.content_type ?? "reel";
    typeCounts.set(ct, (typeCounts.get(ct) ?? 0) + 1);

    if (post.error_message) {
      const key = normalizeError(post.error_message);
      messageCounts.set(key, (messageCounts.get(key) ?? 0) + 1);
    }
  }

  const items: ErrorReportItem[] = errors
    .sort((a, b) => new Date(b.scheduled_at).getTime() - new Date(a.scheduled_at).getTime())
    .map((post) => {
      const contentType = (post.content_type ?? "reel") as ContentType;
      const accountId = (post.platform === "tiktok" ? post.tiktok_account_id : post.account_id) ?? "";
      const { action, href } = recommendAction(post);

      return {
        postId: post.id,
        accountId,
        accountUsername: getPostAccountUsername(post),
        platform: post.platform ?? "instagram",
        contentType,
        contentTypeLabel: CONTENT_TYPE_LABELS[contentType],
        status: post.status,
        errorMessage: post.error_message ?? "Erro desconhecido",
        scheduledAt: post.scheduled_at,
        retryCount: post.retry_count ?? 0,
        nextRetryAt: post.next_retry_at ?? null,
        recommendedAction: action,
        actionHref: href,
        mediaFilename: post.media_urls?.[0]?.split("/").pop()?.split("?")[0] ?? null,
      };
    });

  return {
    errorsToday,
    errorsLast7Days,
    byAccount: [...accountCounts.entries()]
      .map(([accountId, data]) => ({ accountId, username: data.username, count: data.count }))
      .sort((a, b) => b.count - a.count),
    byPlatform: platformCounts,
    byContentType: Object.fromEntries(typeCounts),
    topErrors: [...messageCounts.entries()]
      .map(([message, count]) => ({ message, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10),
    failedPersistent: posts.filter((p) => p.status === "failed_persistent").length,
    stuckProcessing: posts.filter((p) => p.status === "processing").length,
    retryExhausted: posts.filter((p) => p.status === "failed_persistent").length,
    items,
  };
}
