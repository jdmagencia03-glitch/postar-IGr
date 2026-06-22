import { NextRequest, NextResponse } from "next/server";
import { authorizeCronRequest } from "@/lib/admin/cron-auth";
import { getSessionUserId } from "@/lib/meta/oauth";
import { getScheduleJobHeader } from "@/lib/schedule-jobs/repository";
import { createAdminClient } from "@/lib/supabase/admin";
import { executeWarmupRecalculate } from "@/lib/warmup-recalculate";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Recalcula horários de posts pendentes no modo Aquecimento. */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const cronAuthorized = authorizeCronRequest(request);
  const ownerId = cronAuthorized ? null : await getSessionUserId();
  if (!ownerId && !cronAuthorized) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const { id } = await context.params;

  if (ownerId) {
    const supabase = createAdminClient();
    const job = await getScheduleJobHeader(supabase, ownerId, id);
    if (!job) return NextResponse.json({ error: "Job não encontrado" }, { status: 404 });
    if (job.schedule_mode !== "warmup") {
      return NextResponse.json({ error: "job_not_warmup" }, { status: 400 });
    }
  }

  try {
    const result = await executeWarmupRecalculate(id);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status =
      message === "job_not_found"
        ? 404
        : message === "job_not_warmup" || message === "job_missing_batch" || message === "job_missing_account"
          ? 400
          : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
