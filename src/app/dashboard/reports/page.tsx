import { redirect } from "next/navigation";
import { OperationsCenter } from "@/components/operations/OperationsCenter";
import { computeOperationsSnapshot } from "@/lib/operations/compute";
import { buildAllAccountOperationsSummaries } from "@/lib/operations/account-ops";
import { buildOperationsAlerts } from "@/lib/operations/alerts-engine";
import { buildErrorReport } from "@/lib/operations/error-report";
import {
  applyReportFilters,
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

export const dynamic = "force-dynamic";

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

  const allPosts = await getOwnerScheduledPosts(supabase, ownerId, {
    platform: filters.platform,
    accountId: selectedAccountId,
    contentType: filters.contentType,
    hiddenFromReport: false,
    order: "asc",
    limit: 5000,
  });

  const [igAccounts, tiktokAccounts, activeBatch, products, campaigns] = await Promise.all([
    getOwnerAccounts(supabase, ownerId),
    getOwnerTikTokAccounts(supabase, ownerId),
    getActiveBatchSummaryForOwner(supabase, ownerId),
    listOwnerProducts(supabase, ownerId),
    listOwnerCampaigns(supabase, ownerId),
  ]);

  const accountsOverview = await buildAllAccountOperationsSummaries({
    refs: accountRefs,
    igAccounts,
    tiktokAccounts,
    posts: allPosts,
    ownerId,
  });

  const snapshot = computeOperationsSnapshot(allPosts);
  const publicationMetrics = computePublicationMetrics(allPosts);
  const platformMetrics = computePlatformMetrics(allPosts);
  const contentTypeMetrics = computeContentTypeMetrics(allPosts);
  const multiplatformMetrics = computeMultiplatformGroupMetrics(allPosts);
  const errorReport = buildErrorReport(allPosts);
  const publicationAudit = buildPublicationAudit(allPosts, {
    platform: filters.platform,
    contentType: filters.contentType,
    accountId: selectedAccountId,
    auditPeriod: filters.auditPeriod,
    auditDate: filters.auditDate,
  });

  const postIds = new Set(allPosts.map((post) => post.id));
  const { data: recentLogs } = postIds.size
    ? await supabase
        .from("publish_logs")
        .select("created_at")
        .in("post_id", [...postIds])
        .eq("level", "success")
        .order("created_at", { ascending: false })
        .limit(1)
    : { data: [] };

  const operationsAlerts = buildOperationsAlerts({
    accounts: accountsOverview,
    posts: allPosts,
    coverageDays: snapshot.coverageDays,
    cronConfigured: Boolean(process.env.CRON_SECRET?.trim()),
    lastPublishAt: recentLogs?.[0]?.created_at ?? null,
    activeUploadBatchId: activeBatch?.id ?? null,
  });

  const visiblePosts = sortReportPosts(
    applyReportFilters(allPosts, filters),
    filters,
  );

  const campaignRows = buildCampaignOperationsRows(campaigns, allPosts);

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
        filters={filters}
        posts={visiblePosts as ScheduledPost[]}
        allPosts={allPosts as ScheduledPost[]}
        snapshot={snapshot}
        publicationMetrics={publicationMetrics}
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
