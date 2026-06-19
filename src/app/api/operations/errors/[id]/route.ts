import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/meta/oauth";
import { getOperationalErrorById } from "@/lib/operations/operational-errors";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ownerId = await getSessionUserId();
  if (!ownerId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const { id } = await params;
  const supabase = createAdminClient();
  const error = await getOperationalErrorById(supabase, ownerId, id);
  if (!error) return NextResponse.json({ error: "Erro não encontrado" }, { status: 404 });
  return NextResponse.json(error);
}
