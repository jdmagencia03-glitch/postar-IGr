import {
  endOfDay,
  isToday,
  isWithinInterval,
  parseISO,
  startOfDay,
  subDays,
} from "date-fns";
import type { ContentType, PostStatus, ScheduledPost, SocialPlatform } from "@/lib/types";

export type ReportSortField =
  | "scheduled_at"
  | "created_at"
  | "status"
  | "platform"
  | "account"
  | "error_recent"
  | "next_retry";

export type ReportViewTab = "publications" | "metrics" | "errors" | "audit";

export type AuditPeriod = "today" | "yesterday" | "last_7_days" | "last_30_days";

export type ReportQuickFilter =
  | "published_today"
  | "scheduled_today"
  | "next_7_days"
  | "last_7_days"
  | "multiplatform"
  | "grouped_only"
  | "single_only"
  | "retrying"
  | "failed_persistent"
  | "with_error"
  | "without_error";

export type ReportStatusFilter =
  | "all"
  | PostStatus
  | "failed"
  | "failed_all";

export type ReportPeriodFilter = "all" | "today" | "tomorrow" | "week" | "month";

export interface ReportFilters {
  platform: SocialPlatform | "all";
  contentType: ContentType | "all";
  accountId?: string;
  status: ReportStatusFilter;
  period: ReportPeriodFilter;
  dateFrom?: string;
  dateTo?: string;
  quick?: ReportQuickFilter;
  q?: string;
  sort: ReportSortField;
  sortDir: "asc" | "desc";
  view: ReportViewTab;
  auditPeriod?: AuditPeriod;
  auditDate?: string;
  productId?: string;
  campaignId?: string;
}

const STATUS_VALUES = new Set<string>([
  "all",
  "pending",
  "processing",
  "published",
  "failed",
  "retrying",
  "failed_persistent",
  "cancelled",
  "failed_all",
]);

const PERIOD_VALUES = new Set<string>(["all", "today", "tomorrow", "week", "month"]);
const QUICK_VALUES = new Set<string>([
  "published_today",
  "scheduled_today",
  "next_7_days",
  "last_7_days",
  "multiplatform",
  "grouped_only",
  "single_only",
  "retrying",
  "failed_persistent",
  "with_error",
  "without_error",
]);
const SORT_VALUES = new Set<string>([
  "scheduled_at",
  "created_at",
  "status",
  "platform",
  "account",
  "error_recent",
  "next_retry",
]);
const VIEW_VALUES = new Set<string>(["publications", "metrics", "errors", "audit"]);
const AUDIT_PERIOD_VALUES = new Set<string>(["today", "yesterday", "last_7_days", "last_30_days"]);

function pick<T extends string>(value: string | undefined, allowed: Set<string>, fallback: T): T {
  if (value && allowed.has(value)) return value as T;
  return fallback;
}

export function parseReportFilters(
  params: Record<string, string | undefined>,
): ReportFilters {
  return {
    platform: pick(params.platform, new Set(["all", "instagram", "tiktok"]), "all"),
    contentType: pick(
      params.content_type,
      new Set(["all", "reel", "post", "story", "tiktok_video", "youtube_short"]),
      "all",
    ),
    accountId: params.account,
    status: pick(params.status, STATUS_VALUES, "all"),
    period: pick(params.period, PERIOD_VALUES, "all"),
    dateFrom: params.date_from,
    dateTo: params.date_to,
    quick: params.quick && QUICK_VALUES.has(params.quick) ? (params.quick as ReportQuickFilter) : undefined,
    q: params.q?.trim() || undefined,
    sort: pick(params.sort, SORT_VALUES, "scheduled_at"),
    sortDir: params.sort_dir === "asc" ? "asc" : "desc",
    view: pick(params.view, VIEW_VALUES, "publications"),
    auditPeriod: pick(params.audit_period, AUDIT_PERIOD_VALUES, "today") as AuditPeriod,
    auditDate: params.audit_date,
    productId: params.product,
    campaignId: params.campaign,
  };
}

function isFailedStatus(status: PostStatus) {
  return status === "failed" || status === "failed_persistent";
}

function isActiveStatus(status: PostStatus) {
  return status === "pending" || status === "retrying";
}

function postAccountKey(post: ScheduledPost) {
  return post.platform === "tiktok" ? post.tiktok_account_id : post.account_id;
}

function postMatchesSearch(post: ScheduledPost, q: string) {
  const needle = q.toLowerCase();
  const username =
    post.platform === "tiktok"
      ? post.tiktok_accounts?.username ?? post.tiktok_accounts?.display_name
      : post.instagram_accounts?.ig_username;
  const filename = post.media_urls?.[0]?.split("/").pop()?.split("?")[0] ?? "";

  const haystack = [
    username,
    post.caption,
    post.title,
    post.description,
    post.hashtags,
    post.error_message,
    post.platform,
    post.content_type,
    post.status,
    filename,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return haystack.includes(needle);
}

function filterByPeriod(posts: ScheduledPost[], period: ReportPeriodFilter, now = new Date()) {
  if (period === "all") return posts;

  const start = startOfDay(now);
  const end = endOfDay(now);

  if (period === "tomorrow") {
    start.setDate(start.getDate() + 1);
    end.setTime(start.getTime());
    end.setHours(23, 59, 59, 999);
  } else if (period === "week") {
    end.setDate(end.getDate() + 7);
  } else if (period === "month") {
    end.setMonth(end.getMonth() + 1);
  }

  return posts.filter((post) => {
    const date = parseISO(post.scheduled_at);
    return isWithinInterval(date, { start, end });
  });
}

function filterByDateRange(posts: ScheduledPost[], dateFrom?: string, dateTo?: string) {
  if (!dateFrom && !dateTo) return posts;

  const start = dateFrom ? startOfDay(parseISO(dateFrom)) : new Date(0);
  const end = dateTo ? endOfDay(parseISO(dateTo)) : new Date(8640000000000000);

  return posts.filter((post) => {
    const date = parseISO(post.scheduled_at);
    return isWithinInterval(date, { start, end });
  });
}

function filterByQuick(posts: ScheduledPost[], quick: ReportQuickFilter | undefined, now = new Date()) {
  if (!quick) return posts;

  switch (quick) {
    case "published_today":
      return posts.filter(
        (post) => post.status === "published" && post.published_at && isToday(parseISO(post.published_at)),
      );
    case "scheduled_today":
      return posts.filter((post) => isActiveStatus(post.status) && isToday(parseISO(post.scheduled_at)));
    case "next_7_days": {
      const end = endOfDay(now);
      end.setDate(end.getDate() + 7);
      return posts.filter((post) =>
        isWithinInterval(parseISO(post.scheduled_at), { start: startOfDay(now), end }),
      );
    }
    case "last_7_days": {
      const start = startOfDay(subDays(now, 7));
      return posts.filter((post) => {
        const ref = post.published_at ?? post.scheduled_at;
        return isWithinInterval(parseISO(ref), { start, end: endOfDay(now) });
      });
    }
    case "multiplatform":
      return posts.filter((post) => Boolean(post.parent_publish_group_id));
    case "grouped_only": {
      const counts = new Map<string, number>();
      for (const post of posts) {
        if (!post.parent_publish_group_id) continue;
        counts.set(
          post.parent_publish_group_id,
          (counts.get(post.parent_publish_group_id) ?? 0) + 1,
        );
      }
      return posts.filter(
        (post) =>
          post.parent_publish_group_id &&
          (counts.get(post.parent_publish_group_id) ?? 0) > 1,
      );
    }
    case "single_only":
      return posts.filter((post) => {
        if (!post.parent_publish_group_id) return true;
        const siblings = posts.filter((p) => p.parent_publish_group_id === post.parent_publish_group_id);
        return siblings.length <= 1;
      });
    case "retrying":
      return posts.filter((post) => post.status === "retrying");
    case "failed_persistent":
      return posts.filter((post) => post.status === "failed_persistent");
    case "with_error":
      return posts.filter((post) => Boolean(post.error_message) || isFailedStatus(post.status));
    case "without_error":
      return posts.filter((post) => !post.error_message && !isFailedStatus(post.status));
    default:
      return posts;
  }
}

export function applyReportFilters(
  posts: ScheduledPost[],
  filters: ReportFilters,
  now = new Date(),
): ScheduledPost[] {
  let result = [...posts];

  if (filters.status === "failed") {
    result = result.filter((post) => isFailedStatus(post.status));
  } else if (filters.status === "failed_all") {
    result = result.filter((post) => isFailedStatus(post.status) || post.status === "retrying");
  } else if (filters.status === "pending") {
    result = result.filter((post) => isActiveStatus(post.status));
  } else if (filters.status !== "all") {
    result = result.filter((post) => post.status === filters.status);
  }

  result = filterByPeriod(result, filters.period, now);
  result = filterByDateRange(result, filters.dateFrom, filters.dateTo);
  result = filterByQuick(result, filters.quick, now);

  if (filters.q) {
    result = result.filter((post) => postMatchesSearch(post, filters.q!));
  }

  if (filters.productId) {
    result = result.filter((post) => post.product_id === filters.productId);
  }

  if (filters.campaignId) {
    result = result.filter((post) => post.campaign_id === filters.campaignId);
  }

  return result;
}

function statusSortRank(status: PostStatus) {
  const order: PostStatus[] = [
    "processing",
    "retrying",
    "failed",
    "failed_persistent",
    "pending",
    "published",
    "cancelled",
  ];
  return order.indexOf(status);
}

export function sortReportPosts(posts: ScheduledPost[], filters: ReportFilters): ScheduledPost[] {
  const dir = filters.sortDir === "asc" ? 1 : -1;

  return [...posts].sort((a, b) => {
    switch (filters.sort) {
      case "created_at":
        return (new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) * dir;
      case "status":
        return (statusSortRank(a.status) - statusSortRank(b.status)) * dir;
      case "platform":
        return (a.platform ?? "instagram").localeCompare(b.platform ?? "instagram") * dir;
      case "account": {
        const ak = postAccountKey(a) ?? "";
        const bk = postAccountKey(b) ?? "";
        return ak.localeCompare(bk) * dir;
      }
      case "error_recent": {
        const ae = a.error_message ? new Date(a.scheduled_at).getTime() : 0;
        const be = b.error_message ? new Date(b.scheduled_at).getTime() : 0;
        return (ae - be) * dir;
      }
      case "next_retry": {
        const an = a.next_retry_at ? new Date(a.next_retry_at).getTime() : 0;
        const bn = b.next_retry_at ? new Date(b.next_retry_at).getTime() : 0;
        return (an - bn) * dir;
      }
      case "scheduled_at":
      default:
        return (new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime()) * dir;
    }
  });
}

export function buildReportQuery(filters: Partial<ReportFilters> & Record<string, string | undefined>) {
  const query = new URLSearchParams();

  const entries: Array<[string, string | undefined]> = [
    ["platform", filters.platform && filters.platform !== "all" ? filters.platform : undefined],
    ["content_type", filters.contentType && filters.contentType !== "all" ? filters.contentType : undefined],
    ["account", filters.accountId],
    ["status", filters.status && filters.status !== "all" ? filters.status : undefined],
    ["period", filters.period && filters.period !== "all" ? filters.period : undefined],
    ["date_from", filters.dateFrom],
    ["date_to", filters.dateTo],
    ["quick", filters.quick],
    ["q", filters.q],
    ["sort", filters.sort && filters.sort !== "scheduled_at" ? filters.sort : undefined],
    ["sort_dir", filters.sortDir === "asc" ? "asc" : undefined],
    ["view", filters.view && filters.view !== "publications" ? filters.view : undefined],
    ["audit_period", filters.auditPeriod && filters.auditPeriod !== "today" ? filters.auditPeriod : undefined],
    ["audit_date", filters.auditDate],
    ["product", filters.productId],
    ["campaign", filters.campaignId],
  ];

  for (const [key, value] of entries) {
    if (value) query.set(key, value);
  }

  const qs = query.toString();
  return qs ? `/dashboard/reports?${qs}` : "/dashboard/reports";
}
