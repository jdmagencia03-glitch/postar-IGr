import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/meta/oauth";
import { dispatchQueueDrain } from "@/lib/schedule-jobs/dispatch";
import { drainScheduleJobQueue } from "@/lib/schedule-jobs/queue/drain";
import { QUEUE_CRON_MAX_MS } from "@/lib/schedule-jobs/queue/constants";
import { repairScheduleJob } from "@/lib/schedule-jobs/queue/repair";
import { getJobByIdAdmin } from "@/lib/schedule-jobs/queue/tasks";
import { recoverStuckScheduleJobs } from "@/lib/schedule-jobs/queue/stuck";
import { resumeScheduleJob } from "@/lib/schedule-jobs/processor";
import { buildJobStatusFromJob, finalizeJobStatusFromDb, getScheduleJobHeader } from "@/lib/schedule-jobs/repository";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const ownerId = await getSessionUserId();
  if (!ownerId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const { id } = await context.params;
  const supabase = createAdminClient();

  try {
    await resumeScheduleJob(supabase, ownerId, id);

    const job = await getJobByIdAdmin(supabase, id);
    if (job && job.owner_id === ownerId) {
      await recoverStuckScheduleJobs(supabase);
      await repairScheduleJob(supabase, id);
      await dispatchQueueDrain("resume");
      await drainScheduleJobQueue(supabase, {
        workerPrefix: "resume",
        maxMs: QUEUE_CRON_MAX_MS,
      });
    }

    let refreshed = await getScheduleJobHeader(supabase, ownerId, id);
    if (refreshed && (refreshed.status === "processing" || refreshed.status === "queued")) {
      refreshed = await finalizeJobStatusFromDb(supabase, refreshed);
    }
    if (!refreshed) return NextResponse.json({ error: "Job não encontrado" }, { status: 404 });

    return NextResponse.json(buildJobStatusFromJob(refreshed), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao retomar agendamento" },
      { status: 500 },
    );
  }
}
