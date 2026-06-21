import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/meta/oauth";
import { forceContinueScheduleJob } from "@/lib/schedule-jobs/force-continue";
import { buildJobStatusFromJob } from "@/lib/schedule-jobs/repository";
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
    const result = await forceContinueScheduleJob(supabase, ownerId, id);
    return NextResponse.json(
      {
        ...buildJobStatusFromJob(result.job),
        forceContinue: {
          materializedTasks: result.repair.materializedTasks,
          processed: result.drain.processed,
          claimed: result.drain.claimed,
          mode: result.drain.mode,
          elapsedMs: result.drain.elapsedMs,
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao forçar continuação";
    return NextResponse.json(
      {
        ok: false,
        error: "worker_failed",
        message,
        details: message,
      },
      { status: 500 },
    );
  }
}
