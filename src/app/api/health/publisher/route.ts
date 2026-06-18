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
  const now = new Date();
  const nowIso = now.toISOString();
  const posts = await getOwnerScheduledPosts(supabase, ownerId);
  const postIds = new Set(posts.map((post) => post.id));

  const overduePending = posts.filter(
    (post) => post.status === "pending" && post.scheduled_at <= nowIso,
  ).length;
  const stuckProcessing = posts.filter((post) => post.status === "processing").length;
  const retrying = posts.filter((post) => post.status === "retrying").length;
  const failedPersistent = posts.filter((post) => post.status === "failed_persistent").length;
  const pending = posts.filter(
    (post) => post.status === "pending" || post.status === "retrying",
  ).length;

  const { data: recentLogs } = postIds.size
    ? await supabase
        .from("publish_logs")
        .select("created_at")
        .in("post_id", [...postIds])
        .eq("level", "success")
        .order("created_at", { ascending: false })
        .limit(1)
    : { data: [] };

  const lastPublishAt = recentLogs?.[0]?.created_at ?? null;
  let cronStale = false;
  if (lastPublishAt) {
    cronStale = now.getTime() - new Date(lastPublishAt).getTime() > 30 * 60_000 && overduePending > 0;
  } else if (overduePending > 0) {
    cronStale = true;
  }

  let status: "healthy" | "attention" | "critical" = "healthy";
  if (!cronConfigured || stuckProcessing > 0 || failedPersistent >= 3) {
    status = "critical";
  } else if (overduePending > 0 || retrying > 0 || cronStale || failedPersistent > 0) {
    status = "attention";
  }

  const healthy = status === "healthy";

  return NextResponse.json({
    cron_configured: cronConfigured,
    overdue_pending: overduePending,
    stuck_processing: stuckProcessing,
    retrying,
    failed_persistent: failedPersistent,
    pending,
    last_publish_at: lastPublishAt,
    cron_stale: cronStale,
    status,
    healthy,
  });
}
