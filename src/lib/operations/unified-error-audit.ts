import type { SupabaseClient } from "@supabase/supabase-js";
import { isToday, parseISO } from "date-fns";
import { getOwnerAccounts } from "@/lib/accounts";
import { buildErrorReport } from "@/lib/operations/error-report";
import {
  buildAllAccountOperationalSummaries,
  filterPostsForAccount,
  humanizeLastError,
  type AccountOperationalSummary,
} from "@/lib/operations/operational-summary";
import { listOperationalErrors } from "@/lib/operations/operational-errors";
import { buildPublicationAudit } from "@/lib/operations/publication-audit";
import { listStoredFindings } from "@/lib/operations/platform-audit/repository";
import { getOwnerAccountRefs, getOwnerScheduledPosts, type OwnerAccountRef } from "@/lib/posts";
import { getOwnerTikTokAccounts } from "@/lib/tiktok/accounts";
import { buildTikTokPublishDiagnostics } from "@/lib/tiktok/publish-diagnostics";
import type { OperationalError, SocialPlatform } from "@/lib/types";

export type UnifiedAccountHealth = "healthy" | "attention" | "paused_or_blocked" | "error";

export type UnifiedAuditAccount = {
  platform: SocialPlatform;
  account: string;
  accountId: string;
  pending: number;
  failed: number;
  retrying: number;
  publishedToday: number;
  lastError: string | null;
  health: UnifiedAccountHealth;
  playbookConfigured?: boolean;
  publishingPaused?: boolean;
  tokenStatus?: string;
  openOperationalErrors?: number;
  diagnostics?: Record<string, unknown>;
};

export type PanelMismatch = {
  panel: string;
  issue: string;
  expected: string;
  actual: string;
};

export type UnifiedErrorAuditResult = {
  ok: true;
  generatedAt: string;
  ownerId: string;
  accounts: UnifiedAuditAccount[];
  summary: {
    totalAccounts: number;
    accountsWithProblems: number;
    failedPosts: number;
    retryingPosts: number;
    stuckUploads: number;
    offSchedulePosts: number;
    openOperationalErrors: number;
  };
  panelConsistency: {
    centralErrorsMatchesUnifiedAudit: boolean;
    operationsMatchesUnifiedAudit: boolean;
    adminDiagnosticsMatchesUnifiedAudit: boolean;
    mismatches: PanelMismatch[];
  };
  errorsByAccount: Array<{
    accountId: string;
    account: string;
    platform: SocialPlatform;
    operationalErrors: Array<{ title: string; message: string; severity: string; category: string }>;
    failedPosts: number;
    retryingPosts: number;
    lastError: string | null;
  }>;
};

export type UnifiedErrorAuditParams = {
  scope?: "all";
  includeAccounts?: boolean;
  includePosts?: boolean;
  includeDiagnostics?: boolean;
  /** Simula filtros ativos nas telas para detectar divergência */
  simulatePanelFilters?: {
    centralErrorsAccountId?: string;
    centralErrorsPlatform?: SocialPlatform | "all";
    operationsAccountId?: string;
    operationsPlatform?: SocialPlatform | "all";
    adminAuditScope?: string;
  };
};

function accountHandle(ref: OwnerAccountRef) {
  const u = ref.username ?? ref.id.slice(0, 8);
  return u.startsWith("@") ? u : `@${u}`;
}

function isFailedStatus(status: string) {
  return status === "failed" || status === "failed_persistent";
}

function mapHealth(summary: AccountOperationalSummary): UnifiedAccountHealth {
  if (summary.publishingPaused || summary.tokenStatus === "expired") {
    return "paused_or_blocked";
  }
  if (summary.health === "error") return "error";
  if (summary.health === "attention") return "attention";
  return "healthy";
}

function countPostsForAccount(
  posts: Awaited<ReturnType<typeof getOwnerScheduledPosts>>,
  accountId: string,
  platform: SocialPlatform,
) {
  const scoped = filterPostsForAccount(posts, accountId, platform);
  return {
    pending: scoped.filter((p) => p.status === "pending").length,
    failed: scoped.filter((p) => isFailedStatus(p.status)).length,
    retrying: scoped.filter((p) => p.status === "retrying").length,
    publishedToday: scoped.filter(
      (p) => p.status === "published" && p.published_at && isToday(parseISO(p.published_at)),
    ).length,
    lastError:
      humanizeLastError(
        scoped
          .filter((p) => p.error_message)
          .sort((a, b) => new Date(b.scheduled_at).getTime() - new Date(a.scheduled_at).getTime())[0]
          ?.error_message ?? null,
      ),
  };
}

function accountIdsWithOpenOperationalErrors(errors: OperationalError[]) {
  const ids = new Set<string>();
  for (const error of errors) {
    if (error.status === "resolved" || error.status === "ignored") continue;
    if (error.account_id) ids.add(error.account_id);
  }
  return ids;
}

function accountIdsWithPostProblems(
  refs: OwnerAccountRef[],
  posts: Awaited<ReturnType<typeof getOwnerScheduledPosts>>,
) {
  const ids = new Set<string>();
  for (const ref of refs) {
    const counts = countPostsForAccount(posts, ref.id, ref.platform);
    if (counts.failed > 0 || counts.retrying > 0) {
      ids.add(ref.id);
    }
  }
  return ids;
}

function accountIdsWithHealthProblems(summaries: AccountOperationalSummary[]) {
  return new Set(summaries.filter((s) => s.health !== "healthy").map((s) => s.id));
}

function compareSets(a: Set<string>, b: Set<string>) {
  if (a.size !== b.size) return false;
  for (const id of a) {
    if (!b.has(id)) return false;
  }
  return true;
}

export async function buildUnifiedErrorAudit(
  supabase: SupabaseClient,
  ownerId: string,
  params: UnifiedErrorAuditParams = {},
): Promise<UnifiedErrorAuditResult> {
  const includeDiagnostics = params.includeDiagnostics ?? true;

  const [refs, posts, igAccounts, tiktokAccounts, operationalResult] = await Promise.all([
    getOwnerAccountRefs(supabase, ownerId),
    getOwnerScheduledPosts(supabase, ownerId, { hiddenFromReport: false, limit: 5000 }),
    getOwnerAccounts(supabase, ownerId),
    getOwnerTikTokAccounts(supabase, ownerId),
    listOperationalErrors(supabase, ownerId, { status: "open_active" }),
  ]);

  const summaries = await buildAllAccountOperationalSummaries({
    refs,
    igAccounts,
    tiktokAccounts,
    posts,
    ownerId,
  });

  const publicationAudit = buildPublicationAudit(posts);
  const auditFindingsOverview = await listStoredFindings({
    supabase,
    ownerId,
    scope: "overview",
  });
  const auditFindingsTikTokOnly = await listStoredFindings({
    supabase,
    ownerId,
    scope: "tiktok",
  });

  const openErrors = operationalResult.errors;
  const errorsByAccountId = new Map<string, OperationalError[]>();
  for (const error of openErrors) {
    if (!error.account_id) continue;
    const bucket = errorsByAccountId.get(error.account_id) ?? [];
    bucket.push(error);
    errorsByAccountId.set(error.account_id, bucket);
  }

  const ttMap = new Map(tiktokAccounts.map((a) => [a.id, a]));

  const accounts: UnifiedAuditAccount[] = await Promise.all(
    refs.map(async (ref) => {
      const summary = summaries.find((s) => s.id === ref.id && s.platform === ref.platform)!;
      const postCounts = countPostsForAccount(posts, ref.id, ref.platform);
      const accountErrors = errorsByAccountId.get(ref.id) ?? [];

      let diagnostics: Record<string, unknown> | undefined;
      if (includeDiagnostics && ref.platform === "tiktok") {
        const tiktokAccount = ttMap.get(ref.id);
        if (tiktokAccount) {
          const diag = await buildTikTokPublishDiagnostics({ supabase, account: tiktokAccount });
          diagnostics = {
            canPublicPostNow: diag.canPublicPostNow,
            publicPostBlockReason: diag.publicPostBlockReason,
            cronTikTokPrivacyLevel: diag.cronTikTokPrivacyLevel,
            recommendation: diag.recommendation,
          };
        }
      }

      return {
        platform: ref.platform,
        account: accountHandle(ref),
        accountId: ref.id,
        pending: postCounts.pending,
        failed: postCounts.failed,
        retrying: postCounts.retrying,
        publishedToday: postCounts.publishedToday,
        lastError: postCounts.lastError ?? summary.lastError,
        health: mapHealth(summary),
        playbookConfigured: summary.playbookConfigured,
        publishingPaused: summary.publishingPaused,
        tokenStatus: summary.tokenStatus,
        openOperationalErrors: accountErrors.length,
        ...(diagnostics ? { diagnostics } : {}),
      };
    }),
  );

  const failedPosts = accounts.reduce((sum, a) => sum + a.failed, 0);
  const retryingPosts = accounts.reduce((sum, a) => sum + a.retrying, 0);
  const accountsWithProblems = accounts.filter((a) => a.health !== "healthy").length;

  const stuckUploads = operationalResult.summary.stalledUploads;
  const offSchedulePosts = publicationAudit.summary.offScheduleCount;

  const unifiedProblemAccountIds = accountIdsWithHealthProblems(summaries);
  const operationalProblemAccountIds = accountIdsWithOpenOperationalErrors(openErrors);
  const postProblemAccountIds = accountIdsWithPostProblems(refs, posts);

  const mismatches: PanelMismatch[] = [];

  // Central de Erros: summary era calculado com filtros de conta/plataforma
  const sim = params.simulatePanelFilters;
  if (sim?.centralErrorsAccountId || (sim?.centralErrorsPlatform && sim.centralErrorsPlatform !== "all")) {
    const filteredCentral = await listOperationalErrors(supabase, ownerId, {
      status: "open_active",
      accountId: sim.centralErrorsAccountId,
      platform: sim.centralErrorsPlatform === "all" ? undefined : sim.centralErrorsPlatform,
    });
    const filteredIds = accountIdsWithOpenOperationalErrors(filteredCentral.errors);
    if (!compareSets(operationalProblemAccountIds, filteredIds)) {
      mismatches.push({
        panel: "Central de Erros",
        issue: "only_selected_account_loaded",
        expected: "all accounts",
        actual: sim.centralErrorsAccountId
          ? `account filter: ${sim.centralErrorsAccountId}`
          : `platform filter: ${sim.centralErrorsPlatform}`,
      });
    }
  } else if (!compareSets(operationalProblemAccountIds, unifiedProblemAccountIds)) {
    mismatches.push({
      panel: "Central de Erros",
      issue: "operational_errors_account_scope_differs_from_health",
      expected: `${[...unifiedProblemAccountIds].join(", ") || "none"}`,
      actual: `${[...operationalProblemAccountIds].join(", ") || "none"}`,
    });
  }

  // Central de Operações — aba Erros usa posts filtrados
  let operationsFilteredPosts = posts;
  if (sim?.operationsAccountId) {
    operationsFilteredPosts = posts.filter((p) => {
      if (p.platform === "tiktok") return p.tiktok_account_id === sim.operationsAccountId;
      return p.account_id === sim.operationsAccountId;
    });
  } else if (sim?.operationsPlatform && sim.operationsPlatform !== "all") {
    operationsFilteredPosts = posts.filter((p) => (p.platform ?? "instagram") === sim.operationsPlatform);
  }

  const errorReportFiltered = buildErrorReport(operationsFilteredPosts);
  const opsProblemIds = new Set(errorReportFiltered.byAccount.map((r) => r.accountId));
  if (sim?.operationsAccountId || (sim?.operationsPlatform && sim.operationsPlatform !== "all")) {
    if (!compareSets(postProblemAccountIds, opsProblemIds)) {
      mismatches.push({
        panel: "Central de Operações",
        issue: "only_selected_account_loaded",
        expected: "all accounts",
        actual: sim.operationsAccountId
          ? `account filter: ${sim.operationsAccountId}`
          : `platform filter: ${sim.operationsPlatform}`,
      });
    }
  } else if (!compareSets(postProblemAccountIds, opsProblemIds)) {
    mismatches.push({
      panel: "Central de Operações",
      issue: "error_report_account_scope_differs_from_posts",
      expected: `${[...postProblemAccountIds].join(", ") || "none"}`,
      actual: `${[...opsProblemIds].join(", ") || "none"}`,
    });
  }

  // Diagnóstico Admin — escopo TikTok esconde Instagram
  const adminScope = sim?.adminAuditScope ?? "overview";
  const adminFindings =
    adminScope === "tiktok"
      ? auditFindingsTikTokOnly
      : adminScope === "overview"
        ? auditFindingsOverview
        : auditFindingsOverview;

  const allPlatforms = new Set(refs.map((r) => r.platform));
  if (adminScope === "tiktok" && allPlatforms.has("instagram")) {
    mismatches.push({
      panel: "Diagnóstico Admin",
      issue: "scope_filter_hides_platform",
      expected: "all platforms in overview scope",
      actual: "tiktok scope only",
    });
  } else if (
    adminScope === "overview" &&
    adminFindings.length < auditFindingsOverview.length &&
    auditFindingsTikTokOnly.length !== auditFindingsOverview.length
  ) {
    mismatches.push({
      panel: "Diagnóstico Admin",
      issue: "findings_subset_in_ui_scope",
      expected: `${auditFindingsOverview.length} findings overview`,
      actual: `${adminFindings.length} visible in scope ${adminScope}`,
    });
  }

  // Cards "Suas páginas" sempre mostram todas — OK by design
  // Publication metrics bar usava posts filtrados quando conta selecionada
  if (sim?.operationsAccountId) {
    mismatches.push({
      panel: "Relatório de Publicações",
      issue: "metrics_bar_used_filtered_posts",
      expected: "global owner posts for top metrics",
      actual: `filtered by account ${sim.operationsAccountId}`,
    });
  }

  const centralErrorsMatchesUnifiedAudit =
    !mismatches.some((m) => m.panel === "Central de Erros");
  const operationsMatchesUnifiedAudit =
    !mismatches.some((m) => m.panel === "Central de Operações" || m.panel === "Relatório de Publicações");
  const adminDiagnosticsMatchesUnifiedAudit =
    !mismatches.some((m) => m.panel === "Diagnóstico Admin");

  const errorsByAccount = refs.map((ref) => {
    const accountErrors = errorsByAccountId.get(ref.id) ?? [];
    const postCounts = countPostsForAccount(posts, ref.id, ref.platform);
    return {
      accountId: ref.id,
      account: accountHandle(ref),
      platform: ref.platform,
      operationalErrors: accountErrors.map((e) => ({
        title: e.title,
        message: e.message,
        severity: e.severity,
        category: e.category,
      })),
      failedPosts: postCounts.failed,
      retryingPosts: postCounts.retrying,
      lastError: postCounts.lastError,
    };
  });

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    ownerId,
    accounts,
    summary: {
      totalAccounts: accounts.length,
      accountsWithProblems,
      failedPosts,
      retryingPosts,
      stuckUploads,
      offSchedulePosts,
      openOperationalErrors: openErrors.length,
    },
    panelConsistency: {
      centralErrorsMatchesUnifiedAudit,
      operationsMatchesUnifiedAudit,
      adminDiagnosticsMatchesUnifiedAudit,
      mismatches,
    },
    errorsByAccount,
  };
}
