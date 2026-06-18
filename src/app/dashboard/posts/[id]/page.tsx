import { redirect, notFound } from "next/navigation";
import { PostDetailView } from "@/components/operations/PostDetailView";
import { getSessionUserId } from "@/lib/meta/oauth";
import { getOwnerPostById, getOwnerScheduledPosts } from "@/lib/posts";
import { createAdminClient } from "@/lib/supabase/admin";
import type { PublishLog, ScheduledPost } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function PostDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const ownerId = await getSessionUserId();
  if (!ownerId) redirect("/login?next=/dashboard/reports");

  const { id } = await params;
  const supabase = createAdminClient();
  const post = await getOwnerPostById(supabase, ownerId, id);

  if (!post) notFound();

  const { data: publicPost } = await supabase
    .from("scheduled_posts")
    .select("*, instagram_accounts(ig_username, profile_picture_url), tiktok_accounts(username, display_name, profile_picture_url)")
    .eq("id", id)
    .maybeSingle();

  let siblingPosts: ScheduledPost[] = [];
  if (post.parent_publish_group_id) {
    const allPosts = await getOwnerScheduledPosts(supabase, ownerId, { limit: 5000 });
    siblingPosts = allPosts.filter(
      (p) => p.parent_publish_group_id === post.parent_publish_group_id && p.id !== id,
    );
  }

  const { data: logs } = await supabase
    .from("publish_logs")
    .select("*")
    .eq("post_id", id)
    .order("created_at", { ascending: true });

  return (
    <div className="mx-auto max-w-6xl">
      <header className="ig-page-header">
        <h1>Detalhe da publicação</h1>
        <p>Histórico, status e ações para esta publicação.</p>
      </header>
      <PostDetailView
        post={(publicPost ?? post) as ScheduledPost}
        siblingPosts={siblingPosts}
        logs={(logs ?? []) as PublishLog[]}
      />
    </div>
  );
}
