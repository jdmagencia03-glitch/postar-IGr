import {
  inferOperationalEventType,
  operationalEventLabel,
} from "@/lib/operations/post-timeline";
import { getPostAccountUsername } from "@/lib/posts";
import type { PublishLog, ScheduledPost } from "@/lib/types";

export interface OperationalLogRow {
  id: string;
  eventType: string;
  eventLabel: string;
  accountUsername: string;
  platform: string;
  postId: string;
  message: string;
  level: string;
  createdAt: string;
}

export function buildOperationalLogRows(
  logs: PublishLog[],
  postsById: Map<string, ScheduledPost>,
): OperationalLogRow[] {
  return logs.map((log) => {
    const post = postsById.get(log.post_id);
    const message = log.message ?? "";
    const eventType = inferOperationalEventType(message);

    return {
      id: log.id,
      eventType,
      eventLabel: operationalEventLabel(eventType),
      accountUsername: post ? getPostAccountUsername(post) : "—",
      platform: post?.platform ?? "—",
      postId: log.post_id,
      message,
      level: log.level,
      createdAt: log.created_at,
    };
  });
}
