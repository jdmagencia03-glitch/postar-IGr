import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePlatformAdmin } from "@/lib/admin/gate";
import { formatZodError } from "@/lib/api-errors";
import { getSessionUserId } from "@/lib/meta/oauth";
import {
  getAuditSweepMeta,
  listStoredFindings,
  mergeLiveWithStored,
  syncAuditFindings,
} from "@/lib/operations/platform-audit/repository";
import { runPlatformAudit } from "@/lib/operations/platform-audit/runner";
import type { AuditScope } from "@/lib/operations/platform-audit/types";
import type { AuditTier } from "@/lib/operations/platform-audit/tiers";
import { createAdminClient } from "@/lib/supabase/admin";

const bodySchema = z.object({
  scope: z
    .enum([
      "overview",
      "tiktok",
      "instagram",
      "schedule",
      "uploads",
      "publisher",
      "database",
      "ui",
    ])
    .optional()
    .default("overview"),
  tier: z.enum(["critical", "schedule", "full"]).optional().default("full"),
  sync: z.boolean().optional().default(true),
});

async function handleAudit(
  scope: AuditScope,
  tier: AuditTier,
  ownerId: string,
  sync: boolean,
) {
  const supabase = createAdminClient();
  const gate = await requirePlatformAdmin(supabase, ownerId);
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: 403 });
  }

  const result = await runPlatformAudit({ supabase, ownerId, scope, tier });

  if (sync) {
    const syncResult = await syncAuditFindings({
      supabase,
      ownerId,
      findings: result.findings,
      tier,
      trigger: "manual",
    });
    if (syncResult.synced) {
      const stored = await listStoredFindings({ supabase, ownerId, scope, includeResolved: true });
      result.storedFindings = mergeLiveWithStored(result.findings, stored);
    }
  }

  result.sweepMeta = (await getAuditSweepMeta(supabase, ownerId)) ?? undefined;

  return NextResponse.json(result);
}

export async function GET(request: NextRequest) {
  const ownerId = await getSessionUserId();
  if (!ownerId) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const scope = (request.nextUrl.searchParams.get("scope") ?? "overview") as AuditScope;
  const tier = (request.nextUrl.searchParams.get("tier") ?? "full") as AuditTier;
  const sync = request.nextUrl.searchParams.get("sync") !== "false";

  return handleAudit(scope, tier, ownerId, sync);
}

export async function POST(request: NextRequest) {
  const ownerId = await getSessionUserId();
  if (!ownerId) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
  }

  return handleAudit(parsed.data.scope, parsed.data.tier, ownerId, parsed.data.sync);
}
