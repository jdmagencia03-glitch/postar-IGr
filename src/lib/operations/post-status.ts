import type { PostStatus, ScheduledPost } from "@/lib/types";

export function isFailedStatus(status: PostStatus) {
  return status === "failed" || status === "failed_persistent";
}

/** Fila ativa — posts que ainda podem ser publicados ou precisam de ação. */
export function isActiveQueueStatus(status: PostStatus) {
  return (
    status === "pending" ||
    status === "retrying" ||
    status === "processing" ||
    status === "needs_media"
  );
}

/** Problema operacional real — não inclui cancelados nem publicados com erro antigo. */
export function isOperationalProblemStatus(status: PostStatus) {
  return isFailedStatus(status) || status === "retrying" || status === "needs_media";
}

/** Posts visíveis na HUD / listas operacionais por padrão. */
export function isHudVisibleStatus(status: PostStatus) {
  return status !== "cancelled";
}

export function filterHudPosts(posts: ScheduledPost[]) {
  return posts.filter((post) => isHudVisibleStatus(post.status));
}

export function pickLatestOperationalError(posts: ScheduledPost[]) {
  const row = posts
    .filter((post) => isOperationalProblemStatus(post.status) && post.error_message?.trim())
    .sort((a, b) => new Date(b.scheduled_at).getTime() - new Date(a.scheduled_at).getTime())[0];

  return row?.error_message?.trim() ?? null;
}
