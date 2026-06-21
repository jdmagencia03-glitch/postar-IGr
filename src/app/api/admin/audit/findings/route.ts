import { NextRequest, NextResponse } from "next/server";
import { requirePlatformAdmin } from "@/lib/admin/gate";
import { getSessionUserId } from "@/lib/meta/oauth";
import {
  getAuditSweepMeta,
  listStoredFindings,
} from "@/lib/operations/platform-audit/repository";
import type { AuditScope } from "@/lib/operations/platform-audit/types";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(request: NextRequest) {
  const ownerId = await getSessionUserId();
  if (!ownerId) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const gate = await requirePlatformAdmin(supabase, ownerId);
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: 403 });
  }

  const scope = (request.nextUrl.searchParams.get("scope") ?? "overview") as AuditScope;
  const includeResolved = request.nextUrl.searchParams.get("includeResolved") === "true";

  const [findings, sweepMeta] = await Promise.all([
    listStoredFindings({ supabase, ownerId, scope, includeResolved }),
    getAuditSweepMeta(supabase, ownerId),
  ]);

  return NextResponse.json({ findings, sweepMeta, scope });
}
