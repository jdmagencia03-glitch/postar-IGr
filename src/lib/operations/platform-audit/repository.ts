import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CRITICAL_SWEEP_INTERVAL_MS,
  SCHEDULE_SWEEP_INTERVAL_MS,
  type AuditTier,
} from "@/lib/operations/platform-audit/tiers";
import type {
  AuditFinding,
  AuditFindingStatus,
  AuditScope,
  AuditSweepMeta,
  StoredAuditFinding,
} from "@/lib/operations/platform-audit/types";

type AuditFindingRow = {
  id: string;
  owner_id: string;
  fingerprint: string;
  severity: string;
  module: string;
  platform: string;
  account_id: string | null;
  account_handle: string | null;
  title: string;
  description: string;
  evidence: Record<string, unknown>;
  probable_cause: string;
  recommended_fix: string;
  status: AuditFindingStatus;
  occurrence_count: number;
  validation_count: number;
  first_seen_at: string;
  last_seen_at: string;
  resolved_at: string | null;
  reopened_at: string | null;
  ignored_at: string | null;
  last_validated_at: string | null;
  last_validated_by: string | null;
  last_validation_result: StoredAuditFinding["lastValidationResult"];
  updated_at: string;
};

function rowToStored(row: AuditFindingRow): StoredAuditFinding {
  return {
    dbId: row.id,
    id: row.fingerprint,
    fingerprint: row.fingerprint,
    severity: row.severity as StoredAuditFinding["severity"],
    module: row.module as StoredAuditFinding["module"],
    platform: row.platform as StoredAuditFinding["platform"],
    accountId: row.account_id ?? undefined,
    accountHandle: row.account_handle ?? undefined,
    title: row.title,
    description: row.description,
    evidence: row.evidence ?? {},
    probableCause: row.probable_cause,
    recommendedFix: row.recommended_fix,
    canAutoFix: false,
    requiresConfirmation: true,
    dryRunOnly: true,
    status: row.status,
    occurrenceCount: row.occurrence_count,
    validationCount: row.validation_count,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    resolvedAt: row.resolved_at,
    reopenedAt: row.reopened_at,
    ignoredAt: row.ignored_at,
    lastValidatedAt: row.last_validated_at,
    lastValidatedBy: row.last_validated_by,
    lastValidationResult: row.last_validation_result,
  };
}

function isMissingTableError(message: string) {
  return /audit_findings|does not exist|schema cache/i.test(message);
}

export async function syncAuditFindings(params: {
  supabase: SupabaseClient;
  ownerId: string;
  findings: AuditFinding[];
  tier: AuditTier;
  trigger: "manual" | "cron";
}) {
  const now = new Date().toISOString();
  const detected = new Set(params.findings.map((f) => f.id));
  let reopened = 0;

  for (const finding of params.findings) {
    const { data: existing, error: readError } = await params.supabase
      .from("audit_findings")
      .select("*")
      .eq("owner_id", params.ownerId)
      .eq("fingerprint", finding.id)
      .maybeSingle();

    if (readError) {
      if (isMissingTableError(readError.message)) {
        return { synced: false, reason: "table_missing" as const };
      }
      throw new Error(readError.message);
    }

    if (!existing) {
      const { error } = await params.supabase.from("audit_findings").insert({
        owner_id: params.ownerId,
        fingerprint: finding.id,
        severity: finding.severity,
        module: finding.module,
        platform: finding.platform,
        account_id: finding.accountId ?? null,
        account_handle: finding.accountHandle ?? null,
        title: finding.title,
        description: finding.description,
        evidence: finding.evidence,
        probable_cause: finding.probableCause,
        recommended_fix: finding.recommendedFix,
        status: "open",
        occurrence_count: 1,
        first_seen_at: now,
        last_seen_at: now,
        updated_at: now,
      });
      if (error) throw new Error(error.message);
      continue;
    }

    const row = existing as AuditFindingRow;
    let nextStatus: AuditFindingStatus = row.status;

    if (row.status === "resolved") {
      nextStatus = "reopened";
      reopened += 1;
    } else if (row.status === "validating") {
      nextStatus = "open";
    } else if (row.status !== "ignored") {
      nextStatus = "open";
    }

    const { error } = await params.supabase
      .from("audit_findings")
      .update({
        severity: finding.severity,
        title: finding.title,
        description: finding.description,
        evidence: finding.evidence,
        probable_cause: finding.probableCause,
        recommended_fix: finding.recommendedFix,
        account_id: finding.accountId ?? null,
        account_handle: finding.accountHandle ?? null,
        status: nextStatus,
        occurrence_count: row.occurrence_count + 1,
        last_seen_at: now,
        reopened_at: nextStatus === "reopened" ? now : row.reopened_at,
        resolved_at: nextStatus === "reopened" ? null : row.resolved_at,
        updated_at: now,
      })
      .eq("id", row.id);

    if (error) throw new Error(error.message);
  }

  await updateSweepMeta(params.supabase, params.ownerId, params.tier, reopened);

  console.info("[audit-sync]", {
    ownerId: params.ownerId,
    tier: params.tier,
    trigger: params.trigger,
    detected: detected.size,
    reopened,
  });

  return { synced: true, detected: detected.size, reopened };
}

async function updateSweepMeta(
  supabase: SupabaseClient,
  ownerId: string,
  tier: AuditTier,
  reopenedDelta: number,
) {
  const now = new Date().toISOString();
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const { data: counts } = await supabase
    .from("audit_findings")
    .select("status, resolved_at")
    .eq("owner_id", ownerId);

  const openCount =
    counts?.filter((row) => ["open", "reopened", "validating"].includes(row.status as string))
      .length ?? 0;

  const resolvedTodayCount =
    counts?.filter(
      (row) =>
        row.status === "resolved" &&
        row.resolved_at &&
        new Date(row.resolved_at) >= todayStart,
    ).length ?? 0;

  const reopenedCount =
    counts?.filter((row) => row.status === "reopened").length ?? 0;

  const patch: Record<string, unknown> = {
    owner_id: ownerId,
    open_count: openCount,
    resolved_today_count: resolvedTodayCount,
    reopened_count: reopenedCount + reopenedDelta,
    updated_at: now,
  };

  if (tier === "critical") patch.last_critical_sweep_at = now;
  if (tier === "schedule") patch.last_schedule_sweep_at = now;
  if (tier === "full") patch.last_full_sweep_at = now;

  await supabase.from("audit_sweep_meta").upsert(patch);
}

export async function getAuditSweepMeta(
  supabase: SupabaseClient,
  ownerId: string,
): Promise<AuditSweepMeta | null> {
  const { data, error } = await supabase
    .from("audit_sweep_meta")
    .select("*")
    .eq("owner_id", ownerId)
    .maybeSingle();

  if (error) {
    if (isMissingTableError(error.message)) return null;
    throw new Error(error.message);
  }

  if (!data) {
    return {
      lastCriticalSweepAt: null,
      lastScheduleSweepAt: null,
      lastFullSweepAt: null,
      openCount: 0,
      resolvedTodayCount: 0,
      reopenedCount: 0,
      nextCriticalSweepAt: null,
      nextScheduleSweepAt: null,
    };
  }

  const lastCritical = data.last_critical_sweep_at as string | null;
  const lastSchedule = data.last_schedule_sweep_at as string | null;

  return {
    lastCriticalSweepAt: lastCritical,
    lastScheduleSweepAt: lastSchedule,
    lastFullSweepAt: (data.last_full_sweep_at as string | null) ?? null,
    openCount: (data.open_count as number) ?? 0,
    resolvedTodayCount: (data.resolved_today_count as number) ?? 0,
    reopenedCount: (data.reopened_count as number) ?? 0,
    nextCriticalSweepAt: lastCritical
      ? new Date(new Date(lastCritical).getTime() + CRITICAL_SWEEP_INTERVAL_MS).toISOString()
      : null,
    nextScheduleSweepAt: lastSchedule
      ? new Date(new Date(lastSchedule).getTime() + SCHEDULE_SWEEP_INTERVAL_MS).toISOString()
      : null,
  };
}

export async function listStoredFindings(params: {
  supabase: SupabaseClient;
  ownerId: string;
  scope?: AuditScope;
  includeResolved?: boolean;
}) {
  let query = params.supabase
    .from("audit_findings")
    .select("*")
    .eq("owner_id", params.ownerId)
    .order("last_seen_at", { ascending: false });

  if (!params.includeResolved) {
    query = query.in("status", ["open", "reopened", "validating"]);
  }

  const { data, error } = await query;
  if (error) {
    if (isMissingTableError(error.message)) return [];
    throw new Error(error.message);
  }

  let rows = (data ?? []) as AuditFindingRow[];

  if (params.scope && params.scope !== "overview") {
    rows = rows.filter((row) => {
      if (params.scope === "tiktok") return row.platform === "tiktok";
      if (params.scope === "instagram") return row.platform === "instagram";
      if (params.scope === "schedule") return row.module === "schedule";
      if (params.scope === "uploads") return row.module === "upload";
      if (params.scope === "publisher")
        return row.module === "publisher" || row.module === "cron";
      if (params.scope === "database") return row.module === "database";
      if (params.scope === "ui") return row.module === "ui";
      return true;
    });
  }

  return rows.map(rowToStored);
}

export async function validateStoredFinding(params: {
  supabase: SupabaseClient;
  ownerId: string;
  fingerprint: string;
  validatedBy: string;
  stillExists: boolean;
}) {
  const now = new Date().toISOString();
  const result = {
    resolved: !params.stillExists,
    message: params.stillExists ? "O erro ainda existe." : "Erro resolvido.",
    checkedAt: now,
  };

  const { data: existing, error: readError } = await params.supabase
    .from("audit_findings")
    .select("*")
    .eq("owner_id", params.ownerId)
    .eq("fingerprint", params.fingerprint)
    .maybeSingle();

  if (readError) throw new Error(readError.message);
  if (!existing) throw new Error("Achado não encontrado no histórico.");

  const row = existing as AuditFindingRow;
  const nextStatus: AuditFindingStatus = params.stillExists
    ? row.status === "reopened"
      ? "reopened"
      : "open"
    : "resolved";

  const { error } = await params.supabase
    .from("audit_findings")
    .update({
      status: nextStatus,
      validation_count: row.validation_count + 1,
      last_validated_at: now,
      last_validated_by: params.validatedBy,
      last_validation_result: result,
      resolved_at: params.stillExists ? null : now,
      updated_at: now,
    })
    .eq("id", row.id);

  if (error) throw new Error(error.message);

  console.info("[audit-validation]", {
    fingerprint: params.fingerprint,
    stillExists: params.stillExists,
    validatedBy: params.validatedBy,
  });

  return { ...result, status: nextStatus };
}

export async function ignoreStoredFinding(params: {
  supabase: SupabaseClient;
  ownerId: string;
  fingerprint: string;
  ignoredBy: string;
}) {
  const now = new Date().toISOString();
  const { error } = await params.supabase
    .from("audit_findings")
    .update({
      status: "ignored",
      ignored_at: now,
      updated_at: now,
      last_validated_by: params.ignoredBy,
      last_validation_result: {
        resolved: false,
        message: "Ignorado manualmente pelo admin.",
        checkedAt: now,
      },
    })
    .eq("owner_id", params.ownerId)
    .eq("fingerprint", params.fingerprint);

  if (error) throw new Error(error.message);
}

export async function markFindingValidating(
  supabase: SupabaseClient,
  ownerId: string,
  fingerprint: string,
) {
  await supabase
    .from("audit_findings")
    .update({ status: "validating", updated_at: new Date().toISOString() })
    .eq("owner_id", ownerId)
    .eq("fingerprint", fingerprint);
}

export function mergeLiveWithStored(
  live: AuditFinding[],
  stored: StoredAuditFinding[],
): StoredAuditFinding[] {
  const storedMap = new Map(stored.map((row) => [row.fingerprint, row]));

  return live.map((finding) => {
    const prev = storedMap.get(finding.id);
    if (!prev) {
      return {
        ...finding,
        dbId: finding.id,
        fingerprint: finding.id,
        status: "open" as const,
        occurrenceCount: 1,
        validationCount: 0,
        firstSeenAt: new Date().toISOString(),
        lastSeenAt: new Date().toISOString(),
        resolvedAt: null,
        reopenedAt: null,
        ignoredAt: null,
        lastValidatedAt: null,
        lastValidatedBy: null,
        lastValidationResult: null,
      };
    }
    return {
      ...finding,
      ...prev,
      title: finding.title,
      description: finding.description,
      evidence: finding.evidence,
      severity: finding.severity,
    };
  });
}
