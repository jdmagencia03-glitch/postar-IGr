import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/meta/oauth";
import {
  executeOperationalErrorAction,
  getOperationalErrorById,
} from "@/lib/operations/operational-errors";
import { createAdminClient } from "@/lib/supabase/admin";
import type { OperationalErrorActionType } from "@/lib/types";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ownerId = await getSessionUserId();
  if (!ownerId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const { id } = await params;
  let body: { action?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const actionType = body.action as OperationalErrorActionType | undefined;
  if (!actionType) {
    return NextResponse.json({ error: "Ação obrigatória" }, { status: 400 });
  }

  const supabase = createAdminClient();
  const error = await getOperationalErrorById(supabase, ownerId, id);
  if (!error) return NextResponse.json({ error: "Erro não encontrado" }, { status: 404 });

  try {
    const result = await executeOperationalErrorAction(supabase, ownerId, error, actionType);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Falha ao executar ação" },
      { status: 500 },
    );
  }
}
