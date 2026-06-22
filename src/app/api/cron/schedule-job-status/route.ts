import { NextRequest, NextResponse } from "next/server";
import { authorizeCronRequest } from "@/lib/admin/cron-auth";
import { buildJobStatusReadOnly } from "@/lib/schedule-jobs/repository";
import type { ScheduleJobRow } from "@/lib/schedule-jobs/types";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Status resumido do job via CRON (operações). */
export async function GET(request: NextRequest) {
  if (!authorizeCronRequest(request)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const jobId = request.nextUrl.searchParams.get("jobId");
  if (!jobId) {
    return NextResponse.json({ ok: false, error: "job_id_required" }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("schedule_jobs")
    .select("*")
    .eq("id", jobId)
    .maybeSingle();
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ ok: false, error: "job_not_found" }, { status: 404 });
  }

  const status = await buildJobStatusReadOnly(supabase, data as ScheduleJobRow);
  return NextResponse.json({
    ok: true,
    jobId,
    status: status.status,
    postsSaved: status.postsSaved,
    postsInCalendar: status.postsInCalendar,
    failed: status.failed,
    plannedPostsSample: status.plannedPosts?.slice(0, 10),
    scheduleSummary: status.scheduleSummary,
  });
}
