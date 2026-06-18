import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/meta/oauth";
import { getOwnerPostById } from "@/lib/posts";
import { buildPostTimeline } from "@/lib/operations/post-timeline";
import { createAdminClient } from "@/lib/supabase/admin";
import type { PublishLog, ScheduledPost } from "@/lib/types";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const { id } = await params;
  const supabase = createAdminClient();
  const post = await getOwnerPostById(supabase, userId, id);

  if (!post) {
    return NextResponse.json({ error: "Post não encontrado" }, { status: 404 });
  }

  const { data: logs } = await supabase
    .from("publish_logs")
    .select("*")
    .eq("post_id", id)
    .order("created_at", { ascending: true });

  const timeline = buildPostTimeline(post as ScheduledPost, (logs ?? []) as PublishLog[]);

  return NextResponse.json({ logs: logs ?? [], timeline });
}
