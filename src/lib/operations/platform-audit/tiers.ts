import type { AuditFinding } from "@/lib/operations/platform-audit/types";

export type AuditTier = "critical" | "schedule" | "full";

const PREFIX_TIERS: Record<string, AuditTier[]> = {
  dup: ["schedule", "full"],
  tz: ["schedule", "full"],
  grid: ["schedule", "full"],
  job: ["critical", "full"],
  cron: ["critical", "full"],
  "tt-url": ["critical", "full"],
  token: ["critical", "full"],
  paused: ["critical", "full"],
  "health-mismatch": ["full"],
  "counters:pending-mismatch": ["full"],
  "hash-dup": ["full"],
  niche: ["full"],
  upload: ["schedule", "full"],
  db: ["critical", "full"],
};

export function inferTierFromFingerprint(fingerprint: string): AuditTier {
  const prefix = fingerprint.split(":")[0];
  const tiers = PREFIX_TIERS[prefix];
  if (!tiers) return "full";
  if (tiers.includes("critical")) return "critical";
  if (tiers.includes("schedule")) return "schedule";
  return "full";
}

export function filterFindingsByTier(findings: AuditFinding[], tier: AuditTier): AuditFinding[] {
  if (tier === "full") return findings;

  return findings.filter((finding) => {
    const prefix = finding.id.split(":")[0];
    const allowed = PREFIX_TIERS[prefix] ?? ["full"];
    return allowed.includes(tier);
  });
}

export const TIER_POST_LIMIT: Record<AuditTier, number> = {
  critical: 2500,
  schedule: 4000,
  full: 5000,
};

export const CRITICAL_SWEEP_INTERVAL_MS = 5 * 60_000;
export const SCHEDULE_SWEEP_INTERVAL_MS = 15 * 60_000;
