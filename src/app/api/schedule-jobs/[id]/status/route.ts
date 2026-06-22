import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/meta/oauth";
import { buildJobStatusReadOnly, getScheduleJobHeader } from "@/lib/schedule-jobs/repository";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 15;

function statusErrorResponse(jobId: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  console.error("[schedule-job-status-failed]", { jobId, error: message });
  return NextResponse.json(
    {
      ok: false,
      jobId,
      status: "unknown",
      phase: "status_error",
      statusError: true,
      statusErrorMessage: message,
      recommendedAction: "manual_review",
    },
    { status: 200, headers: { "Cache-Control": "no-store" } },
  );
}

/** Leitura rápida de status — sem reconciliação pesada (use POST reconcile-calendar). */
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;

  try {
    const ownerId = await getSessionUserId();
    if (!ownerId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

    const supabase = createAdminClient();
    const job = await getScheduleJobHeader(supabase, ownerId, id);
    if (!job) return NextResponse.json({ error: "Job não encontrado" }, { status: 404 });

    const status = await buildJobStatusReadOnly(supabase, job);
    return NextResponse.json(status, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return statusErrorResponse(id, error);
  }
}
