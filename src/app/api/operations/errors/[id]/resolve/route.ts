import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/meta/oauth";
import { resolveOperationalError } from "@/lib/operations/operational-errors";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ownerId = await getSessionUserId();
  if (!ownerId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const { id } = await params;
  const supabase = createAdminClient();
  try {
    const error = await resolveOperationalError(supabase, ownerId, id);
    return NextResponse.json(error);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Falha ao resolver erro" },
      { status: 500 },
    );
  }
}
