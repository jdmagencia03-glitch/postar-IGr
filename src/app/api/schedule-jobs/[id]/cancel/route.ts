import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/meta/oauth";
import { buildJobStatusFromJob, getScheduleJobHeader } from "@/lib/schedule-jobs/repository";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const ownerId = await getSessionUserId();
  if (!ownerId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const { id } = await context.params;
  const supabase = createAdminClient();
  const now = new Date().toISOString();

  const job = await getScheduleJobHeader(supabase, ownerId, id);
  if (!job) return NextResponse.json({ error: "Job não encontrado" }, { status: 404 });

  if (job.status === "completed" || job.status === "cancelled") {
    return NextResponse.json(buildJobStatusFromJob(job), {
      headers: { "Cache-Control": "no-store" },
    });
  }

  await supabase
    .from("schedule_job_tasks")
    .update({ status: "cancelled", locked_by: null, lock_until: null, updated_at: now })
    .eq("schedule_job_id", id)
    .in("status", ["pending", "processing"]);

  const { error } = await supabase
    .from("schedule_jobs")
    .update({
      status: "cancelled",
      locked_by: null,
      lock_until: null,
      updated_at: now,
    })
    .eq("id", id)
    .eq("owner_id", ownerId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const refreshed = await getScheduleJobHeader(supabase, ownerId, id);
  if (!refreshed) return NextResponse.json({ error: "Job não encontrado" }, { status: 404 });

  return NextResponse.json(buildJobStatusFromJob(refreshed), {
    headers: { "Cache-Control": "no-store" },
  });
}
