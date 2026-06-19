import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/meta/oauth";
import { reportClientOperationalError } from "@/lib/operations/operational-errors";
import { reconcileBatchUpload } from "@/lib/upload/queue";
import { buildHealthOperationalError } from "@/lib/upload/resilience";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const ownerId = await getSessionUserId();
  if (!ownerId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const { id } = await context.params;
  const supabase = createAdminClient();

  try {
    const result = await reconcileBatchUpload(supabase, ownerId, id);

    try {
      const operational = buildHealthOperationalError(result.health, result.releasedLeases);
      if (operational) {
        await reportClientOperationalError(supabase, ownerId, {
          ...operational,
          uploadBatchId: id,
        });
      }
    } catch {
      // tabela operational_errors pode não existir ainda
    }

    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao reconciliar lote" },
      { status: 500 },
    );
  }
}
