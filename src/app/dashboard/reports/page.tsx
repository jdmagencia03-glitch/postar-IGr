import { redirect } from "next/navigation";
import { OperationsCenter } from "@/components/operations/OperationsCenter";
import { computeOperationsSnapshot, getLastPublishedAt } from "@/lib/operations/compute";
import { buildAllAccountOperationalSummaries } from "@/lib/operations/operational-summary";
import { buildOperationsAlerts } from "@/lib/operations/alerts-engine";
import { buildErrorReport } from "@/lib/operations/error-report";
import {
  applyReportFilters,
  filterOwnerPostsInMemory,
  parseReportFilters,
  sortReportPosts,
} from "@/lib/operations/filters";
import {
  computeContentTypeMetrics,
  computeMultiplatformGroupMetrics,
  computePlatformMetrics,
  computePublicationMetrics,
} from "@/lib/operations/metrics";
import { buildPublicationAudit } from "@/lib/operations/publication-audit";
import { buildCampaignOperationsRows } from "@/lib/campaigns/operations-stats";
import { listOwnerCampaigns } from "@/lib/campaigns/campaigns";
import { listOwnerProducts } from "@/lib/products/products";
import { getOwnerAccounts } from "@/lib/accounts";
import { getSessionUserId } from "@/lib/meta/oauth";
import { getOwnerAccountRefs, getOwnerScheduledPosts } from "@/lib/posts";
import { getOwnerTikTokAccounts } from "@/lib/tiktok/accounts";
import { getActiveBatchSummaryForOwner } from "@/lib/upload/batches";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ScheduledPost } from "@/lib/types";
import { withHardTimeout } from "@/lib/with-timeout";

export const dynamic = "force-dynamic";

const REPORTS_LOAD_TIMEOUT_MS = 12_000;

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const ownerId = await getSessionUserId();
  if (!ownerId) redirect("/login?next=/dashboard/reports");

  const params = await searchParams;
  const filters = parseReportFilters(params);

  const supabase = createAdminClient();
  const accountRefs = await getOwnerAccountRefs(supabase, ownerId);
  const visibleRefs = accountRefs.filter(
    (account) => filters.platform === "all" || account.platform === filters.platform,
  );
  const selectedAccountId =
    params.account && visibleRefs.some((account) => account.id === params.account)
      ? params.account
      : undefined;

  filters.accountId = selectedAccountId;

  const ownerAllPosts = await withHardTimeout(
    getOwnerScheduledPosts(supabase, ownerId, {
      hiddenFromReport: false,
      order: "asc",
      limit: 5000,
    }),
    REPORTS_LOAD_TIMEOUT_MS,
    [] as ScheduledPost[],
    "reports-owner-posts",
  );

  const filteredPosts =
    selectedAccountId || filters.platform !== "all" || filters.contentType !== "all"
      ? filterOwnerPostsInMemory(ownerAllPosts, {
          platform: filters.platform,
          accountId: selectedAccountId,
          contentType: filters.contentType,
        })
      : ownerAllPosts;

  const [igAccounts, tiktokAccounts, activeBatch, products, campaigns] = await Promise.all([
    getOwnerAccounts(supabase, ownerId),
    getOwnerTikTokAccounts(supabase, ownerId),
    getActiveBatchSummaryForOwner(supabase, ownerId),
    listOwnerProducts(supabase, ownerId),
    listOwnerCampaigns(supabase, ownerId),
  ]);

  const accountsOverview = await buildAllAccountOperationalSummaries({
    refs: accountRefs,
    igAccounts,
    tiktokAccounts,
    posts: ownerAllPosts,
    ownerId,
  });

  const displayPosts =
    selectedAccountId || filters.platform !== "all" || filters.contentType !== "all"
      ? filteredPosts
      : ownerAllPosts;

  const snapshot = computeOperationsSnapshot(displayPosts);
  const globalSnapshot = computeOperationsSnapshot(ownerAllPosts);
  const publicationMetrics = computePublicationMetrics(displayPosts);
  const globalPublicationMetrics = computePublicationMetrics(ownerAllPosts);
  const platformMetrics = computePlatformMetrics(displayPosts);
  const contentTypeMetrics = computeContentTypeMetrics(displayPosts);
  const multiplatformMetrics = computeMultiplatformGroupMetrics(displayPosts);
  const errorReport = buildErrorReport(ownerAllPosts);
  const publicationAudit = buildPublicationAudit(displayPosts, {
    platform: filters.platform,
    contentType: filters.contentType,
    accountId: selectedAccountId,
    auditPeriod: filters.auditPeriod,
    auditDate: filters.auditDate,
  });

  const lastPublishAt = getLastPublishedAt(ownerAllPosts);

  const operationsAlerts = buildOperationsAlerts({
    accounts: accountsOverview,
    posts: ownerAllPosts,
    coverageDays: globalSnapshot.coverageDays,
    cronConfigured: Boolean(process.env.CRON_SECRET?.trim()),
    lastPublishAt,
    activeUploadBatchId: activeBatch?.id ?? null,
  });

  const visiblePosts = sortReportPosts(
    applyReportFilters(filteredPosts, filters),
    filters,
  );

  const campaignRows = buildCampaignOperationsRows(campaigns, displayPosts);
  const selectedAccountOverview =
    selectedAccountId
      ? accountsOverview.find((account) => account.id === selectedAccountId) ?? null
      : null;

  return (
    <>
      <header className="ig-page-header">
        <h1>Central de operações</h1>
        <p>Relatórios, filtros, métricas e visibilidade detalhada das publicações.</p>
      </header>
      <OperationsCenter
        accounts={accountRefs.map((account) => ({
          id: account.id,
          platform: account.platform,
          ig_username: account.username,
          profile_picture_url: account.profile_picture_url,
        }))}
        accountsOverview={accountsOverview}
        operationsAlerts={operationsAlerts}
        selectedAccountId={selectedAccountId ?? ""}
        selectedAccountOverview={selectedAccountOverview}
        filters={filters}
        posts={visiblePosts as ScheduledPost[]}
        allPosts={displayPosts as ScheduledPost[]}
        snapshot={snapshot}
        globalSnapshot={globalSnapshot}
        publicationMetrics={publicationMetrics}
        globalPublicationMetrics={globalPublicationMetrics}
        platformMetrics={platformMetrics}
        contentTypeMetrics={contentTypeMetrics}
        multiplatformMetrics={multiplatformMetrics}
        errorReport={errorReport}
        publicationAudit={publicationAudit}
        campaignRows={campaignRows}
        filterProducts={products.map((p) => ({ id: p.id, name: p.name }))}
        filterCampaigns={campaigns.map((c) => ({ id: c.id, name: c.name }))}
      />
    </>
  );
}
