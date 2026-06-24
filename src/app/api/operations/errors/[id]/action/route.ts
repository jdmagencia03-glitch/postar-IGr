import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/meta/oauth";
import { operationalErrorActionSchema } from "@/lib/api/schemas/operations";
import { parseJsonBody, parseRouteId } from "@/lib/api/validate-request";
import {
  executeOperationalErrorAction,
  getOperationalErrorById,
} from "@/lib/operations/operational-errors";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ownerId = await getSessionUserId();
  if (!ownerId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const idParsed = await parseRouteId(params);
  if (!idParsed.ok) return idParsed.response;

  const parsed = await parseJsonBody(request, operationalErrorActionSchema);
  if (!parsed.ok) return parsed.response;

  const supabase = createAdminClient();
  const error = await getOperationalErrorById(supabase, ownerId, idParsed.data);
  if (!error) return NextResponse.json({ error: "Erro não encontrado" }, { status: 404 });

  try {
    const result = await executeOperationalErrorAction(
      supabase,
      ownerId,
      error,
      parsed.data.action,
    );
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Falha ao executar ação" },
      { status: 500 },
    );
  }
}
