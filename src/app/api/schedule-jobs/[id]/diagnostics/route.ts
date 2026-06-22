import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/meta/oauth";
import { buildJobStatusFromJob, getScheduleJobHeader } from "@/lib/schedule-jobs/repository";
import { getScheduleJobDiagnostics } from "@/lib/schedule-jobs/queue/repair";
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
    const job = await getScheduleJobHeader(supabase, ownerId, id);
    if (!job) return NextResponse.json({ error: "Job não encontrado" }, { status: 404 });

    const { data: items } = await supabase
      .from("schedule_job_items")
      .select("*")
      .eq("schedule_job_id", id)
      .order("sort_order", { ascending: true });

    const technical = await getScheduleJobDiagnostics(supabase, id);
    const status = buildJobStatusFromJob(job, items ?? undefined);

    let createdPosts: Array<{ id: string; scheduledAt: string; status: string }> = [];
    if (job.upload_batch_id) {
      const { data: posts } = await supabase
        .from("scheduled_posts")
        .select("id, scheduled_at, status")
        .eq("upload_batch_id", job.upload_batch_id);
      createdPosts =
        posts?.map((post) => ({
          id: post.id as string,
          scheduledAt: post.scheduled_at as string,
          status: post.status as string,
        })) ?? [];
    }

    return NextResponse.json(
      {
        ok: true,
        ...status,
        createdPosts,
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
