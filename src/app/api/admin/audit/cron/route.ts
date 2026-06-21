import { NextRequest, NextResponse } from "next/server";
import { resolvePlatformAdminOwnerId } from "@/lib/admin/resolve-owner";
import {
  getAuditSweepMeta,
  syncAuditFindings,
} from "@/lib/operations/platform-audit/repository";
import { runPlatformAudit } from "@/lib/operations/platform-audit/runner";
import type { AuditTier } from "@/lib/operations/platform-audit/tiers";
import { getCronSecret } from "@/lib/security/secrets";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

function authorize(request: NextRequest) {
  const secret = getCronSecret();
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

/** Varredura automática somente leitura — rota oficial para cron-job.org. */
export async function GET(request: NextRequest) {
  if (!authorize(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const tierParam = request.nextUrl.searchParams.get("tier") ?? "critical";
  if (tierParam !== "critical" && tierParam !== "schedule") {
    return NextResponse.json(
      { ok: false, error: "tier deve ser critical ou schedule" },
      { status: 400 },
    );
  }
  const tier = tierParam as AuditTier;

  const supabase = createAdminClient();
  const ownerId = await resolvePlatformAdminOwnerId(supabase);
  if (!ownerId) {
    return NextResponse.json(
      {
        ok: false,
        error: "Admin owner não encontrado — configure PLATFORM_ADMIN_OWNER_IDS ou PLATFORM_ADMIN_HUB_IG",
        hub: process.env.PLATFORM_ADMIN_HUB_IG ?? "deolhonoshape3s",
      },
      { status: 503 },
    );
  }

  const audit = await runPlatformAudit({
    supabase,
    ownerId,
    scope: "overview",
    tier,
  });

  const sync = await syncAuditFindings({
    supabase,
    ownerId,
    findings: audit.findings,
    tier,
    trigger: "cron",
  });

  const sweepMeta = await getAuditSweepMeta(supabase, ownerId);

  const findingsUpdated = sync.synced ? audit.findings.length : 0;
  const reopened = sync.reopened ?? 0;

  console.info("[audit-cron]", {
    tier,
    findingsUpdated,
    reopened,
    openFindings: sweepMeta?.openCount ?? audit.findings.length,
  });

  return NextResponse.json({
    ok: true,
    tier,
    findingsUpdated,
    openFindings: sweepMeta?.openCount ?? audit.findings.length,
    resolvedToday: sweepMeta?.resolvedTodayCount ?? 0,
    reopened,
    ranAt: audit.ranAt,
    dryRun: true,
  });
}
