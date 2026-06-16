import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/meta/oauth";
import { getOwnerScheduledPosts } from "@/lib/posts";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(request: NextRequest) {
  const ownerId = await getSessionUserId();
  if (!ownerId) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const posts = await getOwnerScheduledPosts(supabase, ownerId);
  const postIds = posts.map((post) => post.id);

  if (!postIds.length) {
    return NextResponse.json([]);
  }

  const { data, error } = await supabase
    .from("publish_logs")
    .select("*, scheduled_posts(caption, media_type, scheduled_at, platform)")
    .in("post_id", postIds)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}
