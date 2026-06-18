import type { ScheduledPost } from "@/lib/types";

export type ScheduledPostListItem =
  | { kind: "single"; post: ScheduledPost }
  | { kind: "group"; groupId: string; posts: ScheduledPost[] };

export function groupScheduledPostsByPublishGroup(
  posts: ScheduledPost[],
): ScheduledPostListItem[] {
  const byGroup = new Map<string, ScheduledPost[]>();

  for (const post of posts) {
    const groupId = post.parent_publish_group_id;
    if (!groupId) continue;
    const bucket = byGroup.get(groupId) ?? [];
    bucket.push(post);
    byGroup.set(groupId, bucket);
  }

  const multiGroupIds = new Set(
    [...byGroup.entries()]
      .filter(([, items]) => items.length > 1)
      .map(([groupId]) => groupId),
  );

  const emittedGroups = new Set<string>();
  const items: ScheduledPostListItem[] = [];

  for (const post of posts) {
    const groupId = post.parent_publish_group_id;
    if (groupId && multiGroupIds.has(groupId)) {
      if (emittedGroups.has(groupId)) continue;
      emittedGroups.add(groupId);
      items.push({
        kind: "group",
        groupId,
        posts: byGroup.get(groupId) ?? [post],
      });
      continue;
    }

    items.push({ kind: "single", post });
  }

  return items;
}

export function publishGroupLabel(posts: ScheduledPost[], index: number) {
  const filename = posts[0]?.media_urls?.[0]?.split("/").pop()?.split("?")[0];
  const base = filename ? filename.replace(/\.[^.]+$/, "") : `Vídeo ${index + 1}`;
  return base;
}
