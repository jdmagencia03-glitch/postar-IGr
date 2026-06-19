import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/meta/oauth";
import { buildJobStatus, getScheduleJob } from "@/lib/schedule-jobs/repository";
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
  const loaded = await getScheduleJob(supabase, ownerId, id);

  if (!loaded) return NextResponse.json({ error: "Job não encontrado" }, { status: 404 });

  return NextResponse.json(buildJobStatus(loaded.job, loaded.items), {
    headers: { "Cache-Control": "no-store" },
  });
}
