import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/meta/oauth";
import { finalizePostsForJob } from "@/lib/schedule-jobs/finalize-posts";
import { loadJobConsistencySnapshot } from "@/lib/schedule-jobs/consistency";
import { drainScheduleJobQueue } from "@/lib/schedule-jobs/queue/drain";
import { QUEUE_CRON_MAX_MS } from "@/lib/schedule-jobs/queue/constants";
import { repairScheduleJob } from "@/lib/schedule-jobs/queue/repair";
import {
  SCHEDULE_JOB_SMALL_BATCH_MAX,
  SCHEDULE_JOB_SMALL_INSERT_STALL_MS,
} from "@/lib/schedule-jobs/constants";
import {
  buildJobStatusForJob,
  finalizeJobStatusFromDb,
  getScheduleJobHeader,
} from "@/lib/schedule-jobs/repository";
import { deriveScheduleJobView } from "@/lib/schedule-jobs/state";
import { logScheduleJobEvent } from "@/lib/schedule-jobs/state";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function maybeRecoverStuckJob(
  supabase: ReturnType<typeof createAdminClient>,
  ownerId: string,
  jobId: string,
) {
  const header = await getScheduleJobHeader(supabase, ownerId, jobId);
  if (!header) return header;

  const view = deriveScheduleJobView(header);
  const consistency = await loadJobConsistencySnapshot(supabase, header);
  const smallBatch = header.total_items <= SCHEDULE_JOB_SMALL_BATCH_MAX;
  const msSinceUpdate = Date.now() - new Date(header.updated_at).getTime();

  const shouldKick =
    smallBatch &&
    view.phase === "saving_posts" &&
    view.postsSaved < header.total_items &&
    !view.workerActive &&
    msSinceUpdate >= 15_000;

  const shouldAutoFinalize =
    view.stalledReason === "insert_chunk_not_started" ||
    consistency.recommendedAction === "finalize_posts" ||
    (view.canFinalizePosts &&
      !view.workerActive &&
      msSinceUpdate >= SCHEDULE_JOB_SMALL_INSERT_STALL_MS);

  if (!shouldKick && !shouldAutoFinalize) {
    return header;
  }

  await repairScheduleJob(supabase, jobId);
  await drainScheduleJobQueue(supabase, {
    workerPrefix: "status-kick",
    maxMs: smallBatch ? QUEUE_CRON_MAX_MS : 10_000,
  });

  let refreshed = await getScheduleJobHeader(supabase, ownerId, jobId);
  if (!refreshed) return header;

  const afterKick = deriveScheduleJobView(refreshed);
  if (
    shouldAutoFinalize &&
    afterKick.canFinalizePosts &&
    afterKick.postsSaved < refreshed.total_items &&
    !afterKick.workerActive
  ) {
    const result = await finalizePostsForJob(supabase, ownerId, jobId, {
      maxMs: smallBatch ? 120_000 : 60_000,
    });
    refreshed = result.job;
  }

  if (refreshed.status === "processing" || refreshed.status === "queued") {
    refreshed = await finalizeJobStatusFromDb(supabase, refreshed);
  }

  return refreshed;
}

/** Somente leitura de status — com auto-recuperação para lotes pequenos travados. */
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const ownerId = await getSessionUserId();
    if (!ownerId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

    const { id } = await context.params;
    const supabase = createAdminClient();
    let job = await getScheduleJobHeader(supabase, ownerId, id);

    if (!job) return NextResponse.json({ error: "Job não encontrado" }, { status: 404 });

    job = await maybeRecoverStuckJob(supabase, ownerId, id);
    if (!job) return NextResponse.json({ error: "Job não encontrado" }, { status: 404 });

    if (job.status === "processing" || job.status === "queued") {
      job = await finalizeJobStatusFromDb(supabase, job);
    }

    const { data: items } = await supabase
      .from("schedule_job_items")
      .select("*")
      .eq("schedule_job_id", id)
      .order("sort_order", { ascending: true });

    logScheduleJobEvent("schedule-job-status", job);

    return NextResponse.json(await buildJobStatusForJob(supabase, job, items ?? undefined), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("[schedule-job-status-failed]", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao carregar status" },
      { status: 500 },
    );
  }
}
