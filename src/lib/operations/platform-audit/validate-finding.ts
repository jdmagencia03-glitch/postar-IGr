import type { SupabaseClient } from "@supabase/supabase-js";
import { inferTierFromFingerprint } from "@/lib/operations/platform-audit/tiers";
import {
  markFindingValidating,
  validateStoredFinding,
} from "@/lib/operations/platform-audit/repository";
import { runPlatformAudit } from "@/lib/operations/platform-audit/runner";

export async function validateAuditFinding(params: {
  supabase: SupabaseClient;
  ownerId: string;
  fingerprint: string;
  validatedBy: string;
}) {
  try {
    await markFindingValidating(params.supabase, params.ownerId, params.fingerprint);
  } catch {
    // Tabela audit_findings ainda não migrada — validação live apenas
  }

  const tier = inferTierFromFingerprint(params.fingerprint);
  const audit = await runPlatformAudit({
    supabase: params.supabase,
    ownerId: params.ownerId,
    scope: "overview",
    tier,
    onlyFingerprint: params.fingerprint,
  });

  const stillExists = audit.findings.some((f) => f.id === params.fingerprint);

  try {
    const result = await validateStoredFinding({
      supabase: params.supabase,
      ownerId: params.ownerId,
      fingerprint: params.fingerprint,
      validatedBy: params.validatedBy,
      stillExists,
    });

    return {
      ...result,
      checkedFinding: params.fingerprint,
      liveMatches: audit.findings,
    };
  } catch {
    return {
      resolved: !stillExists,
      message: stillExists ? "O erro ainda existe." : "Erro resolvido.",
      status: stillExists ? ("open" as const) : ("resolved" as const),
      checkedAt: new Date().toISOString(),
      checkedFinding: params.fingerprint,
      liveMatches: audit.findings,
      persisted: false,
    };
  }
}
