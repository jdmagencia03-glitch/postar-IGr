import type { SocialPlatform } from "@/lib/types";

export type AuditSeverity = "critical" | "high" | "medium" | "low";

export type AuditModule =
  | "schedule"
  | "upload"
  | "publisher"
  | "cron"
  | "token"
  | "database"
  | "ui"
  | "ai"
  | "calendar"
  | "regression";

export type AuditScope =
  | "overview"
  | "tiktok"
  | "instagram"
  | "schedule"
  | "uploads"
  | "publisher"
  | "database"
  | "ui";

export type AuditFinding = {
  id: string;
  severity: AuditSeverity;
  module: AuditModule;
  platform: SocialPlatform | "system";
  accountId?: string;
  accountHandle?: string;
  title: string;
  description: string;
  evidence: Record<string, unknown>;
  probableCause: string;
  recommendedFix: string;
  canAutoFix: boolean;
  requiresConfirmation: boolean;
  dryRunOnly: true;
};

export type AuditSummary = {
  critical: number;
  high: number;
  medium: number;
  low: number;
  total: number;
  accountsWithProblems: number;
  healthyAccounts: number;
  cronHealthy: boolean;
  stuckJobs: number;
  duplicateSlots: number;
  invalidTokens: number;
};

export type AuditFindingStatus =
  | "open"
  | "validating"
  | "resolved"
  | "ignored"
  | "reopened";

export type StoredAuditFinding = AuditFinding & {
  dbId: string;
  fingerprint: string;
  status: AuditFindingStatus;
  occurrenceCount: number;
  validationCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  resolvedAt: string | null;
  reopenedAt: string | null;
  ignoredAt: string | null;
  lastValidatedAt: string | null;
  lastValidatedBy: string | null;
  lastValidationResult: {
    resolved: boolean;
    message: string;
    checkedAt: string;
  } | null;
};

export type AuditSweepMeta = {
  lastCriticalSweepAt: string | null;
  lastScheduleSweepAt: string | null;
  lastFullSweepAt: string | null;
  openCount: number;
  resolvedTodayCount: number;
  reopenedCount: number;
  nextCriticalSweepAt: string | null;
  nextScheduleSweepAt: string | null;
};

export type PlatformAuditResult = {
  dryRun: true;
  ranAt: string;
  scope: AuditScope;
  ownerId: string;
  tier?: import("@/lib/operations/platform-audit/tiers").AuditTier;
  summary: AuditSummary;
  findings: AuditFinding[];
  storedFindings?: StoredAuditFinding[];
  sweepMeta?: AuditSweepMeta;
  regression?: {
    lastDeployCommit: string | null;
    lastDeployRef: string | null;
    note: string;
  };
};
