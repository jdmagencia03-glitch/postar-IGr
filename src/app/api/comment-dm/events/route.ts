import { NextResponse } from "next/server";
import { listEventsForAutomation } from "@/lib/comment-dm/repository";
import { getSessionUserId } from "@/lib/meta/oauth";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(request: Request) {
  const ownerId = await getSessionUserId();
  if (!ownerId) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const url = new URL(request.url);
  const automationId = url.searchParams.get("automation_id");
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 50), 200);

  if (!automationId) {
    return NextResponse.json({ error: "automation_id obrigatório" }, { status: 400 });
  }

  const supabase = createAdminClient();
  const events = await listEventsForAutomation(supabase, ownerId, automationId, limit);
  return NextResponse.json(events);
}
