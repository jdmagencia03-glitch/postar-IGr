import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/meta/oauth";
import { dispatchQueueDrain } from "@/lib/schedule-jobs/dispatch";
import { drainScheduleJobQueue } from "@/lib/schedule-jobs/queue/drain";
import { QUEUE_CRON_MAX_MS } from "@/lib/schedule-jobs/queue/constants";
import { repairScheduleJob } from "@/lib/schedule-jobs/queue/repair";
import { recoverStuckScheduleJobs } from "@/lib/schedule-jobs/queue/stuck";
import { getJobByIdAdmin } from "@/lib/schedule-jobs/queue/tasks";
import { isScheduleJobQueueReady } from "@/lib/schedule-jobs/queue/schema";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const ownerId = await getSessionUserId();
  if (!ownerId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const supabase = createAdminClient();
  const limit = Math.min(Number(request.nextUrl.searchParams.get("limit") ?? 50), 100);

  const { data, error } = await supabase
    .from("schedule_jobs")
    .select(
      "id, owner_id, account_id, upload_batch_id, status, current_step, total_items, processed_items, completed_items, failed_items, schedule_summary, error_message, locked_by, last_heartbeat_at, updated_at, created_at",
    )
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const ownerJobs = (data ?? []).filter((row) => row.owner_id === ownerId);

  return NextResponse.json({ jobs: ownerJobs });
}

export async function POST(request: NextRequest) {
  const ownerId = await getSessionUserId();
  if (!ownerId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const body = (await request.json()) as { action: string; jobId?: string };
  const supabase = createAdminClient();

  if (body.action === "recover_stuck") {
    await recoverStuckScheduleJobs(supabase);
    await dispatchQueueDrain("admin-recover");
    await drainScheduleJobQueue(supabase, {
      workerPrefix: "admin-recover",
      maxMs: QUEUE_CRON_MAX_MS,
    });
    return NextResponse.json({ ok: true, message: "Jobs travados reencaminhados" });
  }

  if (body.action === "recover_job" && body.jobId) {
    const job = await getJobByIdAdmin(supabase, body.jobId);
    if (!job || job.owner_id !== ownerId) {
      return NextResponse.json({ error: "Job não encontrado" }, { status: 404 });
    }

    await repairScheduleJob(supabase, job.id);
    await dispatchQueueDrain("admin-recover-job");
    await drainScheduleJobQueue(supabase, {
      workerPrefix: "admin-recover-job",
      maxMs: QUEUE_CRON_MAX_MS,
    });
    return NextResponse.json({ ok: true, message: "Job reencaminhado para fila" });
  }

  if (body.action === "cancel_job" && body.jobId) {
    const job = await getJobByIdAdmin(supabase, body.jobId);
    if (!job || job.owner_id !== ownerId) {
      return NextResponse.json({ error: "Job não encontrado" }, { status: 404 });
    }

    await supabase
      .from("schedule_jobs")
      .update({ status: "cancelled", updated_at: new Date().toISOString() })
      .eq("id", job.id);

    if (await isScheduleJobQueueReady(supabase)) {
      await supabase
        .from("schedule_job_tasks")
        .update({ status: "cancelled", updated_at: new Date().toISOString() })
        .eq("schedule_job_id", job.id)
        .in("status", ["pending", "processing", "failed"]);
    }

    return NextResponse.json({ ok: true, message: "Job cancelado" });
  }

  return NextResponse.json({ error: "Ação inválida" }, { status: 400 });
}
