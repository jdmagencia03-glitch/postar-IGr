import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/meta/oauth";
import { listBatchHistoryForOwner } from "@/lib/upload/batches";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET() {
  const ownerId = await getSessionUserId();
  if (!ownerId) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const batches = await listBatchHistoryForOwner(supabase, ownerId, 50);

  return NextResponse.json({ batches });
}
