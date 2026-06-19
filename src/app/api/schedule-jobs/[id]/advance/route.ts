import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/meta/oauth";
import { advanceScheduleJob } from "@/lib/schedule-jobs/processor";
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
    const status = await advanceScheduleJob(supabase, ownerId, id);
    return NextResponse.json(status, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Falha ao avançar agendamento",
        userMessage:
          "A conexão caiu durante o agendamento. O progresso foi salvo — use Retomar agendamento.",
      },
      { status: 500 },
    );
  }
}
