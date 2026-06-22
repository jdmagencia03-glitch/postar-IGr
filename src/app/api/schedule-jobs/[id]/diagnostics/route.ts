import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/meta/oauth";
import {
  buildJobDiagnosticsEnrichment,
  loadJobConsistencySnapshot,
  repairSavePostsTaskConsistency,
} from "@/lib/schedule-jobs/consistency";
import { getScheduleJobDiagnostics } from "@/lib/schedule-jobs/queue/repair";
import { buildJobStatusForJob, getScheduleJobHeader } from "@/lib/schedule-jobs/repository";
import { reconcileJobFromCalendarPosts } from "@/lib/schedule-jobs/reconcile-calendar";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/** Diagnóstico do job para o dono (sem permissão admin global). */
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const ownerId = await getSessionUserId();
  if (!ownerId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const { id } = await context.params;
  const supabase = createAdminClient();

  try {
    let job = await getScheduleJobHeader(supabase, ownerId, id);
    if (!job) return NextResponse.json({ error: "Job não encontrado" }, { status: 404 });

    await repairSavePostsTaskConsistency(supabase, id);

    const refreshed = await getScheduleJobHeader(supabase, ownerId, id);
    if (refreshed) job = refreshed;

    const reconciled = await reconcileJobFromCalendarPosts(supabase, job);
    if (reconciled) job = reconciled;

    const { data: items } = await supabase
      .from("schedule_job_items")
      .select("*")
      .eq("schedule_job_id", id)
      .order("sort_order", { ascending: true });

    const technical = await getScheduleJobDiagnostics(supabase, id);
    const consistency = await loadJobConsistencySnapshot(supabase, job);
    const enrichment = await buildJobDiagnosticsEnrichment(
      supabase,
      job,
      items ?? [],
      consistency,
    );
    const status = await buildJobStatusForJob(supabase, job, items ?? undefined);

    return NextResponse.json(
      {
        ok: true,
        ...status,
        ...enrichment,
        technical,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha no diagnóstico" },
      { status: 500 },
    );
  }
}
