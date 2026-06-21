import type { SupabaseClient } from "@supabase/supabase-js";
import { buildPublicMediaUrl } from "@/lib/storage/media-url-validation";
import { MEDIA_REFERENCED_POST_STATUSES, STORAGE_DELETE_BLOCKED_LOG } from "@/lib/media/constants";

export type StorageDeleteBlock = {
  path: string;
  publicUrl: string | null;
  referencingPostIds: string[];
};

export async function findPostsReferencingStoragePaths(
  supabase: SupabaseClient,
  storagePaths: string[],
) {
  if (!storagePaths.length) return [] as StorageDeleteBlock[];

  const publicUrls = storagePaths
    .map((path) => buildPublicMediaUrl(path))
    .filter(Boolean) as string[];

  const blocks: StorageDeleteBlock[] = [];

  for (const path of storagePaths) {
    const publicUrl = buildPublicMediaUrl(path);
    const referencingPostIds = new Set<string>();

    if (publicUrl) {
      const { data: byUrl } = await supabase
        .from("scheduled_posts")
        .select("id, media_urls, status")
        .in("status", [...MEDIA_REFERENCED_POST_STATUSES])
        .contains("media_urls", [publicUrl]);

      for (const post of byUrl ?? []) {
        referencingPostIds.add(post.id);
      }
    }

    const { data: byAsset } = await supabase
      .from("media_assets")
      .select("id")
      .eq("storage_path", path);

    const assetIds = (byAsset ?? []).map((row) => row.id);
    if (assetIds.length) {
      const { data: postsByAsset } = await supabase
        .from("scheduled_posts")
        .select("id")
        .in("media_asset_id", assetIds)
        .in("status", [...MEDIA_REFERENCED_POST_STATUSES]);

      for (const post of postsByAsset ?? []) {
        referencingPostIds.add(post.id);
      }
    }

    if (referencingPostIds.size) {
      blocks.push({
        path,
        publicUrl,
        referencingPostIds: [...referencingPostIds],
      });
    }
  }

  return blocks;
}

export async function assertStoragePathsSafeToDelete(
  supabase: SupabaseClient,
  storagePaths: string[],
) {
  const blocks = await findPostsReferencingStoragePaths(supabase, storagePaths);
  if (!blocks.length) {
    return { ok: true as const };
  }

  console.warn(
    STORAGE_DELETE_BLOCKED_LOG,
    JSON.stringify({
      blockedPaths: blocks.length,
      sample: blocks.slice(0, 5),
    }),
  );

  return {
    ok: false as const,
    blocks,
    message: STORAGE_DELETE_BLOCKED_LOG,
  };
}

export async function safeRemoveStorageObjects(
  supabase: SupabaseClient,
  storagePaths: string[],
) {
  const unique = [...new Set(storagePaths.filter(Boolean))];
  if (!unique.length) {
    return { removed: 0, blocked: [] as StorageDeleteBlock[] };
  }

  const guard = await assertStoragePathsSafeToDelete(supabase, unique);
  if (!guard.ok) {
    const blockedPaths = new Set(guard.blocks.map((b) => b.path));
    const allowed = unique.filter((path) => !blockedPaths.has(path));

    let removed = 0;
    if (allowed.length) {
      for (let offset = 0; offset < allowed.length; offset += 100) {
        const chunk = allowed.slice(offset, offset + 100);
        const { error } = await supabase.storage.from("media").remove(chunk);
        if (error) {
          console.warn("[storage-delete-guard] partial_remove_error", error.message);
        } else {
          removed += chunk.length;
        }
      }
    }

    return { removed, blocked: guard.blocks };
  }

  for (let offset = 0; offset < unique.length; offset += 100) {
    const chunk = unique.slice(offset, offset + 100);
    const { error } = await supabase.storage.from("media").remove(chunk);
    if (error) {
      throw new Error(error.message);
    }
  }

  return { removed: unique.length, blocked: [] as StorageDeleteBlock[] };
}
