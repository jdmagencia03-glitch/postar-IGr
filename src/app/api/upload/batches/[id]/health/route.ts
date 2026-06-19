import { NextRequest, NextResponse } from "next/server";
import { getBatchUploadHealth } from "@/lib/upload/queue";
import { getSessionUserId } from "@/lib/meta/oauth";
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
    const health = await getBatchUploadHealth(supabase, ownerId, id);
    if (!health) return NextResponse.json({ error: "Lote não encontrado" }, { status: 404 });
    return NextResponse.json(health, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao carregar saúde do lote" },
      { status: 500 },
    );
  }
}
