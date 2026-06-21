import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/meta/oauth";
import { finalizePostsForJob } from "@/lib/schedule-jobs/finalize-posts";
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
    const result = await finalizePostsForJob(supabase, ownerId, id, { maxMs: 280_000 });
    return NextResponse.json(
      {
        ...buildJobStatusFromJob(result.job),
        finalizePosts: {
          savedThisRun: result.savedThisRun,
          batches: result.batches,
          timedOut: result.timedOut,
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao finalizar posts";
    return NextResponse.json(
      {
        ok: false,
        error: "worker_failed",
        step: "saving_posts",
        message,
        details: message,
      },
      { status: 500 },
    );
  }
}
