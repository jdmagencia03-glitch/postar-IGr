import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/meta/oauth";
import { buildJobStatusFromJob, finalizeJobStatusFromDb, getScheduleJobHeader } from "@/lib/schedule-jobs/repository";
import { logScheduleJobEvent } from "@/lib/schedule-jobs/state";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/** Somente leitura de status — processamento ocorre na fila (Inngest/cron). */
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

    if (job.status === "processing" || job.status === "queued") {
      job = await finalizeJobStatusFromDb(supabase, job);
    }

    let items = undefined;
    if (!job.config?.schedule_plan?.plannedPosts?.length) {
      const { data } = await supabase
        .from("schedule_job_items")
        .select("*")
        .eq("schedule_job_id", id)
        .order("sort_order", { ascending: true });
      items = data ?? undefined;
    }

    logScheduleJobEvent("schedule-job-status", job);

    return NextResponse.json(buildJobStatusFromJob(job, items), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao carregar status" },
      { status: 500 },
    );
  }
}
