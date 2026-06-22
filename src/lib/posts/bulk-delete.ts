import type { SupabaseClient } from "@supabase/supabase-js";
import { getOwnerAccountRefs } from "@/lib/posts";
import type { PostStatus } from "@/lib/types";

const CHUNK_SIZE = 100;

const DELETABLE_STATUSES = new Set<PostStatus>([
  "pending",
  "processing",
  "failed",
  "retrying",
  "failed_persistent",
  "cancelled",
  "needs_media",
]);

export type BulkDeletePostsResult = {
  ok: boolean;
  requested: number;
  deleted: number;
  ignoredPublished: number;
  ignoredNotDeletable: number;
  notFound: number;
  failed: number;
  errors: Array<{ postId: string; reason: string }>;
};

type PostRow = {
  id: string;
  status: PostStatus;
  platform: string | null;
  account_id: string | null;
  tiktok_account_id: string | null;
};

function isOwnedByAccounts(
  post: PostRow,
  igIds: Set<string>,
  ttIds: Set<string>,
): boolean {
  if (post.platform === "tiktok") {
    return Boolean(post.tiktok_account_id && ttIds.has(post.tiktok_account_id));
  }
  return Boolean(post.account_id && igIds.has(post.account_id));
}

export async function bulkDeleteOwnerPosts(
  supabase: SupabaseClient,
  ownerId: string,
  postIds: string[],
  options?: { ignorePublished?: boolean },
): Promise<BulkDeletePostsResult> {
  const ignorePublished = options?.ignorePublished ?? true;
  const uniqueIds = [...new Set(postIds.filter(Boolean))];

  const accountRefs = await getOwnerAccountRefs(supabase, ownerId);
  const igIds = new Set(
    accountRefs.filter((account) => account.platform === "instagram").map((account) => account.id),
  );
  const ttIds = new Set(
    accountRefs.filter((account) => account.platform === "tiktok").map((account) => account.id),
  );

  let deleted = 0;
  let ignoredPublished = 0;
  let ignoredNotDeletable = 0;
  let notFound = 0;
  let failed = 0;
  const errors: Array<{ postId: string; reason: string }> = [];

  for (let offset = 0; offset < uniqueIds.length; offset += CHUNK_SIZE) {
    const chunk = uniqueIds.slice(offset, offset + CHUNK_SIZE);
    const { data, error } = await supabase
      .from("scheduled_posts")
      .select("id, status, platform, account_id, tiktok_account_id")
      .in("id", chunk);

    if (error) {
      failed += chunk.length;
      for (const postId of chunk) {
        errors.push({ postId, reason: error.message });
      }
      continue;
    }

    const rows = (data ?? []) as PostRow[];
    const found = new Map(rows.map((row) => [row.id, row]));
    const toDelete: string[] = [];

    for (const postId of chunk) {
      const post = found.get(postId);
      if (!post) {
        notFound += 1;
        continue;
      }

      if (!isOwnedByAccounts(post, igIds, ttIds)) {
        notFound += 1;
        continue;
      }

      if (ignorePublished && post.status === "published") {
        ignoredPublished += 1;
        continue;
      }

      if (!DELETABLE_STATUSES.has(post.status)) {
        ignoredNotDeletable += 1;
        continue;
      }

      toDelete.push(post.id);
    }

    for (let deleteOffset = 0; deleteOffset < toDelete.length; deleteOffset += CHUNK_SIZE) {
      const deleteChunk = toDelete.slice(deleteOffset, deleteOffset + CHUNK_SIZE);
      const { error: deleteError } = await supabase
        .from("scheduled_posts")
        .delete()
        .in("id", deleteChunk);

      if (deleteError) {
        failed += deleteChunk.length;
        for (const postId of deleteChunk) {
          errors.push({ postId, reason: deleteError.message });
        }
      } else {
        deleted += deleteChunk.length;
      }
    }
  }

  return {
    ok: failed === 0,
    requested: uniqueIds.length,
    deleted,
    ignoredPublished,
    ignoredNotDeletable,
    notFound,
    failed,
    errors: errors.slice(0, 50),
  };
}
