import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePlatformAdmin } from "@/lib/admin/gate";
import { formatZodError } from "@/lib/api-errors";
import { getSessionUserId } from "@/lib/meta/oauth";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildScheduleJobDiagnostics } from "@/lib/schedule-jobs/admin-diagnostics";

const bodySchema = z.object({
  batchId: z.string().uuid(),
});

/** Diagnóstico de jobs de agendamento por lote (admin). */
export async function POST(request: NextRequest) {
  const sessionOwnerId = await getSessionUserId();
  if (!sessionOwnerId) {
    return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const gate = await requirePlatformAdmin(supabase, sessionOwnerId);
  if (!gate.ok) {
    return NextResponse.json({ ok: false, error: "forbidden", message: gate.error }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: formatZodError(parsed.error) }, { status: 400 });
  }

  const result = await buildScheduleJobDiagnostics(
    supabase,
    sessionOwnerId,
    parsed.data.batchId,
  );

  if (!result.ok) {
    return NextResponse.json(result, { status: result.error === "batch_not_found" ? 404 : 500 });
  }

  return NextResponse.json(result);
}
