import { NextRequest, NextResponse } from "next/server";
import { authorizeCronRequest } from "@/lib/admin/cron-auth";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Status resumido do job via CRON (operações). */
export async function GET(request: NextRequest) {
  if (!authorizeCronRequest(request)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const jobId =
    request.nextUrl.searchParams.get("jobId") ??
    "f4ac3a3b-885b-44b5-ba18-c65a78f9723b";

  const supabase = createAdminClient();
  const { data: job, error } = await supabase
    .from("schedule_jobs")
    .select("id, status, total_items, completed_items, failed_items, upload_batch_id, schedule_summary")
    .eq("id", jobId)
    .maybeSingle();
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  if (!job) {
    return NextResponse.json({ ok: false, error: "job_not_found" }, { status: 404 });
  }

  const { count: postsInCalendar } = await supabase
    .from("scheduled_posts")
    .select("id", { count: "exact", head: true })
    .eq("upload_batch_id", job.upload_batch_id as string);

  const { data: pendingPosts } = await supabase
    .from("scheduled_posts")
    .select("id, scheduled_at, status")
    .eq("upload_batch_id", job.upload_batch_id as string)
    .in("status", ["pending", "processing", "retrying"])
    .order("scheduled_at", { ascending: true })
    .limit(10);

  return NextResponse.json({
    ok: true,
    jobId,
    status: job.status,
    postsSaved: job.completed_items,
    postsInCalendar: postsInCalendar ?? 0,
    failed: job.failed_items,
    total: job.total_items,
    scheduleSummary: job.schedule_summary,
    plannedPostsSample:
      pendingPosts?.map((post, index) => ({
        dayIndex: index + 1,
        scheduledAt: post.scheduled_at as string,
        status: post.status as string,
      })) ?? [],
  });
}
