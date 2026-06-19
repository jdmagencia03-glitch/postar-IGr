import { NextRequest, NextResponse } from "next/server";
import { getBatchStatusLight } from "@/lib/upload/batches";
import { getSessionUserId } from "@/lib/meta/oauth";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const ownerId = await getSessionUserId();
  if (!ownerId) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const { id } = await context.params;
  const supabase = createAdminClient();

  try {
    const status = await getBatchStatusLight(supabase, ownerId, id);
    if (!status) {
      return NextResponse.json({ error: "Lote não encontrado" }, { status: 404 });
    }

    return NextResponse.json(status, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao carregar status do lote";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
