import type { PostStatus, ScheduledPost } from "@/lib/types";

export type PublishGroupStatus =
  | "complete"
  | "partial"
  | "error"
  | "retrying"
  | "pending"
  | "cancelled";

export interface PublishGroupSummary {
  groupId: string;
  posts: ScheduledPost[];
  status: PublishGroupStatus;
  statusLabel: string;
  destinationCount: number;
  platforms: string[];
  publishedCount: number;
  failedCount: number;
  retryingCount: number;
}

function isFailed(status: PostStatus) {
  return status === "failed" || status === "failed_persistent";
}

function isPending(status: PostStatus) {
  return status === "pending" || status === "retrying";
}

export function derivePublishGroupStatus(posts: ScheduledPost[]): PublishGroupStatus {
  if (!posts.length) return "pending";

  if (posts.every((p) => p.status === "published")) return "complete";
  if (posts.every((p) => p.status === "cancelled")) return "cancelled";
  if (posts.some((p) => p.status === "retrying")) return "retrying";
  if (posts.some((p) => isFailed(p.status))) return "error";
  if (posts.some((p) => p.status === "published")) return "partial";
  if (posts.some((p) => isPending(p.status) || p.status === "processing")) return "pending";

  return "pending";
}

export function publishGroupStatusLabel(status: PublishGroupStatus) {
  switch (status) {
    case "complete":
      return "Completo";
    case "partial":
      return "Parcial";
    case "error":
      return "Com erro";
    case "retrying":
      return "Em retry";
    case "cancelled":
      return "Cancelado";
    default:
      return "Pendente";
  }
}

export function publishGroupStatusClass(status: PublishGroupStatus) {
  switch (status) {
    case "complete":
      return "text-emerald-600 bg-emerald-500/10";
    case "partial":
      return "text-ig-primary bg-ig-primary/10";
    case "error":
      return "text-ig-danger bg-ig-danger/10";
    case "retrying":
      return "text-amber-600 bg-amber-500/10";
    case "cancelled":
      return "text-ig-muted bg-ig-secondary";
    default:
      return "text-ig-text bg-ig-secondary";
  }
}

export function summarizePublishGroup(groupId: string, posts: ScheduledPost[]): PublishGroupSummary {
  const status = derivePublishGroupStatus(posts);
  const platforms = [...new Set(posts.map((p) => p.platform ?? "instagram"))];

  return {
    groupId,
    posts,
    status,
    statusLabel: publishGroupStatusLabel(status),
    destinationCount: posts.length,
    platforms,
    publishedCount: posts.filter((p) => p.status === "published").length,
    failedCount: posts.filter((p) => isFailed(p.status)).length,
    retryingCount: posts.filter((p) => p.status === "retrying").length,
  };
}

export function destinationLabel(post: ScheduledPost) {
  const type = post.content_type ?? "reel";
  if (type === "reel") return "Instagram Reel";
  if (type === "post") return "Instagram Post";
  if (type === "story") return "Instagram Story";
  if (type === "tiktok_video") return "TikTok Video";
  return type;
}
