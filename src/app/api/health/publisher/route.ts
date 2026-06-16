import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/meta/oauth";
import { getOwnerScheduledPosts } from "@/lib/posts";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET() {
  const ownerId = await getSessionUserId();
  if (!ownerId) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const cronConfigured = Boolean(process.env.CRON_SECRET?.trim());
  const supabase = createAdminClient();
  const now = new Date().toISOString();
  const posts = await getOwnerScheduledPosts(supabase, ownerId);
  const postIds = new Set(posts.map((post) => post.id));

  const overduePending = posts.filter(
    (post) => post.status === "pending" && post.scheduled_at <= now,
  ).length;
  const stuckProcessing = posts.filter((post) => post.status === "processing").length;

  const { data: recentLogs } = postIds.size
    ? await supabase
        .from("publish_logs")
        .select("created_at")
        .in("post_id", [...postIds])
        .eq("level", "success")
        .order("created_at", { ascending: false })
        .limit(1)
    : { data: [] };

  return NextResponse.json({
    cron_configured: cronConfigured,
    overdue_pending: overduePending,
    stuck_processing: stuckProcessing,
    last_publish_at: recentLogs?.[0]?.created_at ?? null,
    healthy: cronConfigured && overduePending === 0 && stuckProcessing === 0,
  });
}
