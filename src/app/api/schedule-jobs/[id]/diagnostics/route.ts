import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/meta/oauth";
import { getScheduleJobDiagnostics } from "@/lib/schedule-jobs/queue/repair";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const ownerId = await getSessionUserId();
  if (!ownerId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const { id } = await context.params;
  const supabase = createAdminClient();

  try {
    const { data: owned } = await supabase
      .from("schedule_jobs")
      .select("id")
      .eq("id", id)
      .eq("owner_id", ownerId)
      .maybeSingle();

    if (!owned) return NextResponse.json({ error: "Job não encontrado" }, { status: 404 });

    const diagnostics = await getScheduleJobDiagnostics(supabase, id);
    return NextResponse.json(diagnostics, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha no diagnóstico" },
      { status: 500 },
    );
  }
}
