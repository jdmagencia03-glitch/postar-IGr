import type { SupabaseClient } from "@supabase/supabase-js";
import { deleteBunnyMediaObject, getBunnyMediaBackend } from "@/lib/storage/bunny";
import { MEDIA_BUCKET, buildAllPublicMediaUrls } from "@/lib/storage/media-path";
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

  const blocks: StorageDeleteBlock[] = [];

  for (const path of storagePaths) {
    const publicUrls = buildAllPublicMediaUrls(path);
    const referencingPostIds = new Set<string>();

    for (const publicUrl of publicUrls) {
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
        publicUrl: publicUrls[0] ?? null,
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

async function removeSupabaseStorageObjects(supabase: SupabaseClient, storagePaths: string[]) {
  for (let offset = 0; offset < storagePaths.length; offset += 100) {
    const chunk = storagePaths.slice(offset, offset + 100);
    const { error } = await supabase.storage.from(MEDIA_BUCKET).remove(chunk);
    if (error) {
      throw new Error(error.message);
    }
  }
}

async function removeBunnyMediaObjects(storagePaths: string[]) {
  for (const path of storagePaths) {
    await deleteBunnyMediaObject(path);
  }
}

async function removeStorageObjectsFromProviders(
  supabase: SupabaseClient,
  storagePaths: string[],
) {
  if (getBunnyMediaBackend() !== "none") {
    await removeBunnyMediaObjects(storagePaths);
  }
  if (process.env.NEXT_PUBLIC_SUPABASE_URL) {
    await removeSupabaseStorageObjects(supabase, storagePaths).catch((error) => {
      console.warn("[storage-delete-guard] supabase_legacy_remove", error);
    });
  }
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
      try {
        await removeStorageObjectsFromProviders(supabase, allowed);
        removed = allowed.length;
      } catch (error) {
        console.warn(
          "[storage-delete-guard] partial_remove_error",
          error instanceof Error ? error.message : error,
        );
      }
    }

    return { removed, blocked: guard.blocks };
  }

  await removeStorageObjectsFromProviders(supabase, unique);

  return { removed: unique.length, blocked: [] as StorageDeleteBlock[] };
}
