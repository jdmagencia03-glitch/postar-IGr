import type { PostStatus } from "@/lib/types";

export const CALENDAR_PENDING_STATUSES = [
  "pending",
  "processing",
  "retrying",
  "failed",
] as const satisfies readonly PostStatus[];

export const CALENDAR_PUBLISHED_STATUSES = ["published"] as const satisfies readonly PostStatus[];

export const CALENDAR_CANCELLED_STATUSES = ["cancelled"] as const satisfies readonly PostStatus[];

export const CALENDAR_NORMAL_STATUSES = [
  ...CALENDAR_PENDING_STATUSES,
  "scheduled",
  ...CALENDAR_PUBLISHED_STATUSES,
] as const;

export const CALENDAR_EXCLUDED_NORMAL_STATUSES = [
  "cancelled",
  "deleted",
  "failed_persistent",
  "needs_media",
] as const;

export type CalendarViewKey = "pending" | "all" | "published" | "cancelled";

/** Normaliza view da URL/UI para chave interna. `active` equivale a pendentes. */
export function normalizeCalendarView(view?: string | null): CalendarViewKey {
  switch (view) {
    case "cancelled":
      return "cancelled";
    case "published":
      return "published";
    case "all":
      return "all";
    case "active":
    case "pending":
    default:
      return "pending";
  }
}

export function isCalendarPendingStatus(status: string): boolean {
  if (status === "scheduled") return true;
  return (CALENDAR_PENDING_STATUSES as readonly string[]).includes(status);
}

export function isCalendarPublishedStatus(status: string): boolean {
  return status === "published";
}

export function isCalendarCancelledStatus(status: string): boolean {
  return status === "cancelled";
}

export function isCalendarNormalStatus(status: string): boolean {
  return (CALENDAR_NORMAL_STATUSES as readonly string[]).includes(status);
}

export function isCalendarExcludedNormalStatus(status: string): boolean {
  return (CALENDAR_EXCLUDED_NORMAL_STATUSES as readonly string[]).includes(status);
}

export function getCalendarStatusesForView(view?: string | null): readonly string[] {
  switch (normalizeCalendarView(view)) {
    case "cancelled":
      return CALENDAR_CANCELLED_STATUSES;
    case "published":
      return CALENDAR_PUBLISHED_STATUSES;
    case "all":
      return [...CALENDAR_PENDING_STATUSES, "scheduled", ...CALENDAR_PUBLISHED_STATUSES];
    case "pending":
    default:
      return [...CALENDAR_PENDING_STATUSES, "scheduled"];
  }
}

export function filterPostsForCalendarView<T extends { status: string }>(
  posts: T[],
  view?: string | null,
): T[] {
  const normalized = normalizeCalendarView(view);

  if (normalized === "cancelled") {
    return posts.filter((post) => isCalendarCancelledStatus(post.status));
  }

  if (normalized === "published") {
    return posts.filter((post) => isCalendarPublishedStatus(post.status));
  }

  if (normalized === "all") {
    return posts.filter((post) => isCalendarNormalStatus(post.status));
  }

  return posts.filter((post) => isCalendarPendingStatus(post.status));
}

export function countCalendarPendingStatuses(statuses: string[]): number {
  return statuses.filter((status) => isCalendarPendingStatus(status)).length;
}

export function countCalendarPublishedStatuses(statuses: string[]): number {
  return statuses.filter((status) => isCalendarPublishedStatus(status)).length;
}

export function countCalendarCancelledStatuses(statuses: string[]): number {
  return statuses.filter((status) => isCalendarCancelledStatus(status)).length;
}

export function countCalendarAllStatuses(statuses: string[]): number {
  return statuses.filter((status) => isCalendarNormalStatus(status)).length;
}
