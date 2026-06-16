import { formatInstagramCaption } from "@/lib/ai/caption-format";
import { canEditPost, getOwnerScheduledPosts } from "@/lib/posts";
import type { SupabaseClient } from "@supabase/supabase-js";

export async function formatCaptionsForOwner(
  supabase: SupabaseClient,
  ownerId: string,
  options: {
    postIds?: string[];
    accountId?: string;
  } = {},
) {
  const posts = await getOwnerScheduledPosts(supabase, ownerId, {
    accountId: options.accountId,
    hiddenFromReport: false,
    limit: 5000,
  });

  const postIdSet = options.postIds?.length ? new Set(options.postIds) : null;

  const targets = posts.filter(
    (post) =>
      canEditPost(post.status) &&
      post.caption?.trim() &&
      (!postIdSet || postIdSet.has(post.id)),
  );

  let updated = 0;
  let unchanged = 0;
  let failed = 0;
  const results: Array<{ id: string; ok: boolean; error?: string }> = [];

  for (const post of targets) {
    const formatted = formatInstagramCaption(post.caption ?? "");
    if (formatted === (post.caption ?? "").trim()) {
      unchanged += 1;
      results.push({ id: post.id, ok: true });
      continue;
    }

    const { error } = await supabase
      .from("scheduled_posts")
      .update({ caption: formatted })
      .eq("id", post.id);

    if (error) {
      failed += 1;
      results.push({ id: post.id, ok: false, error: error.message });
      continue;
    }

    updated += 1;
    results.push({ id: post.id, ok: true });
  }

  return {
    total: targets.length,
    updated,
    unchanged,
    failed,
    results,
  };
}
