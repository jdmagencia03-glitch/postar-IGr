import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/meta/oauth";
import {
  buildJobStatusReadOnly,
  getScheduleJobHeader,
} from "@/lib/schedule-jobs/repository";
import { drainScheduleJobQueue } from "@/lib/schedule-jobs/queue/drain";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Avanço via fila — não usa mais processPlanChunk legado em request longa. */
export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const ownerId = await getSessionUserId();
  if (!ownerId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const { id } = await context.params;
  const supabase = createAdminClient();

  try {
    const job = await getScheduleJobHeader(supabase, ownerId, id);
    if (!job) {
      return NextResponse.json({ error: "Job não encontrado" }, { status: 404 });
    }

    await drainScheduleJobQueue(supabase, {
      workerPrefix: "advance",
      maxMs: 25_000,
    });

    const status = await buildJobStatusReadOnly(supabase, job);
    return NextResponse.json(status, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Falha ao avançar agendamento",
        userMessage:
          "O processamento segue em fila no servidor — acompanhe o progresso.",
      },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
