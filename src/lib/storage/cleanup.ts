import type { SupabaseClient } from "@supabase/supabase-js";
import { logPublishEvent } from "@/lib/publish/cron";
import { safeRemoveStorageObjects } from "@/lib/media/storage-delete-guard";

/** Tempo após publicação antes de apagar o arquivo do Supabase Storage. */
export const MEDIA_CLEANUP_DELAY_MS = readHours(
  process.env.MEDIA_CLEANUP_DELAY_HOURS,
  2,
) * 60 * 60 * 1000;

const CLEANUP_BATCH_SIZE = 30;

function readHours(value: string | undefined, fallback: number) {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/** Extrai o path do bucket `media` a partir da URL pública do Supabase. */
export function parseSupabaseMediaStoragePath(url: string): string | null {
  try {
    const pathname = new URL(url).pathname;
    const marker = "/storage/v1/object/public/media/";
    const index = pathname.indexOf(marker);
    if (index === -1) return null;
    return decodeURIComponent(pathname.slice(index + marker.length));
  } catch {
    return null;
  }
}

export async function cleanupPublishedMedia(
  supabase: SupabaseClient,
  limit = CLEANUP_BATCH_SIZE,
) {
  const cutoff = new Date(Date.now() - MEDIA_CLEANUP_DELAY_MS).toISOString();

  const { data: posts, error } = await supabase
    .from("scheduled_posts")
    .select("id, media_urls")
    .eq("status", "published")
    .is("media_cleaned_at", null)
    .not("published_at", "is", null)
    .lte("published_at", cutoff)
    .order("published_at", { ascending: true })
    .limit(limit);

  if (error) {
    throw new Error(error.message);
  }

  const results: Array<{ id: string; deleted: number; error?: string }> = [];

  for (const post of posts ?? []) {
    const urls = post.media_urls ?? [];
    const paths = [
      ...new Set(
        urls.map((url: string) => parseSupabaseMediaStoragePath(url)).filter(Boolean) as string[],
      ),
    ];

    try {
      if (paths.length) {
        const removal = await safeRemoveStorageObjects(supabase, paths);
        if (removal.blocked.length) {
          throw new Error(
            `${removal.blocked.length} arquivo(s) bloqueados — ainda referenciados por posts ativos`,
          );
        }
      }

      if (urls.length) {
        await supabase
          .from("upload_files")
          .update({
            removed: true,
            public_url: null,
            updated_at: new Date().toISOString(),
          })
          .in("public_url", urls);
      }

      const cleanedAt = new Date().toISOString();
      const { error: updateError } = await supabase
        .from("scheduled_posts")
        .update({
          media_urls: [],
          media_cleaned_at: cleanedAt,
          updated_at: cleanedAt,
        })
        .eq("id", post.id)
        .is("media_cleaned_at", null);

      if (updateError) {
        throw new Error(updateError.message);
      }

      await logPublishEvent(
        supabase,
        post.id,
        "info",
        paths.length
          ? `Mídia removida do storage (${paths.length} arquivo${paths.length > 1 ? "s" : ""})`
          : "Post marcado como limpo (sem URL de storage)",
      );

      results.push({ id: post.id, deleted: paths.length });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Falha ao limpar mídia";
      results.push({ id: post.id, deleted: 0, error: message });
    }
  }

  return {
    eligible_cutoff: cutoff,
    processed: results.length,
    deleted_files: results.reduce((sum, item) => sum + item.deleted, 0),
    results,
  };
}
