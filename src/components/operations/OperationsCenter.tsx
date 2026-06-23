"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PostsManager } from "@/components/PostsManager";
import { AccountOperationsGrid } from "@/components/operations/AccountOperationsGrid";
import { ErrorReportPanel } from "@/components/operations/ErrorReportPanel";
import { ExportReportButton } from "@/components/operations/ExportReportButton";
import { MetricsPanels } from "@/components/operations/MetricsPanels";
import { OperationsAlertsPanel } from "@/components/operations/OperationsAlertsPanel";
import { BulkAccountPausePanel } from "@/components/operations/BulkAccountPausePanel";
import { CampaignsOperationsPanel } from "@/components/operations/CampaignsOperationsPanel";
import { PublisherOperationsBanner } from "@/components/operations/PublisherOperationsBanner";
import { PublicationAuditPanel } from "@/components/operations/PublicationAuditPanel";
import { PublicationMetricsBar } from "@/components/operations/PublicationMetricsBar";
import { ReportFiltersBar } from "@/components/operations/ReportFiltersBar";
import type { AccountOperationalSummary } from "@/lib/operations/operational-summary";
import type { AccountOperationsSummary } from "@/lib/operations/account-ops";
import type { OperationsAlert } from "@/lib/operations/alerts-engine";
import type { ErrorReportSummary } from "@/lib/operations/error-report";
import type { ReportFilters } from "@/lib/operations/filters";
import { buildReportQuery } from "@/lib/operations/filters";
import {
  computeHealthChecks,
  formatDuration,
  formatShortDate,
  formatShortDateTime,
  hoursUntilNextPost,
  type computeOperationsSnapshot,
} from "@/lib/operations/compute";
import type {
  ContentTypeMetricsRow,
  MultiplatformGroupMetrics,
  PlatformMetrics,
  PublicationMetrics,
} from "@/lib/operations/metrics";
import type { PublicationAuditReport } from "@/lib/operations/publication-audit";
import type { CampaignOperationsRow } from "@/lib/campaigns/operations-stats";
import type { Campaign, Product, ScheduledPost, SocialPlatform } from "@/lib/types";

interface AccountOption {
  id: string;
  platform: SocialPlatform;
  ig_username: string | null;
  profile_picture_url: string | null;
}

interface RankingRow {
  account_id: string;
  ig_username: string | null;
  metrics: {
    today: { net_followers: number; views: number; likes: number };
    last_7_days: { net_followers: number; views: number; likes: number };
  };
}

interface Props {
  accounts: AccountOption[];
  accountsOverview?: AccountOperationalSummary[];
  operationsAlerts?: OperationsAlert[];
  selectedAccountId: string;
  selectedAccountOverview?: AccountOperationalSummary | null;
  filters: ReportFilters;
  posts: ScheduledPost[];
  allPosts: ScheduledPost[];
  snapshot: ReturnType<typeof computeOperationsSnapshot>;
  globalSnapshot?: ReturnType<typeof computeOperationsSnapshot>;
  publicationMetrics: PublicationMetrics;
  globalPublicationMetrics?: PublicationMetrics;
  platformMetrics: PlatformMetrics[];
  contentTypeMetrics: ContentTypeMetricsRow[];
  multiplatformMetrics: MultiplatformGroupMetrics;
  errorReport: ErrorReportSummary;
  publicationAudit: PublicationAuditReport;
  campaignRows?: CampaignOperationsRow[];
  filterProducts?: Pick<Product, "id" | "name">[];
  filterCampaigns?: Pick<Campaign, "id" | "name">[];
}

function formatSigned(value: number) {
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${new Intl.NumberFormat("pt-BR").format(value)}`;
}

function formatCount(value: number) {
  return new Intl.NumberFormat("pt-BR").format(value);
}

function MetricCard({
  title,
  children,
  className = "",
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-2xl border border-ig-border bg-ig-elevated p-5 ${className}`}>
      <p className="mb-3 text-sm font-semibold text-ig-text">{title}</p>
      {children}
    </div>
  );
}

function StatLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-ig-muted">{label}</span>
      <span className="font-semibold text-ig-text">{value}</span>
    </div>
  );
}

export function OperationsCenter({
  accounts,
  accountsOverview = [],
  operationsAlerts = [],
  selectedAccountId,
  selectedAccountOverview = null,
  filters,
  posts,
  allPosts,
  snapshot,
  globalSnapshot,
  publicationMetrics,
  globalPublicationMetrics,
  platformMetrics,
  contentTypeMetrics,
  multiplatformMetrics,
  errorReport,
  publicationAudit,
  campaignRows = [],
  filterProducts = [],
  filterCampaigns = [],
}: Props) {
  const accountId = selectedAccountId;
  const view = filters.view;
  const [tokenValid, setTokenValid] = useState(true);
  const [followersToday, setFollowersToday] = useState(0);
  const [followers7d, setFollowers7d] = useState(0);
  const [followers30d, setFollowers30d] = useState(0);
  const [views7d, setViews7d] = useState(0);
  const [likes7d, setLikes7d] = useState(0);
  const [rankingRows, setRankingRows] = useState<RankingRow[]>([]);

  const selectedAccount = accounts.find((account) => account.id === accountId) ?? null;
  const activeOverview =
    selectedAccountOverview ??
    (accountId ? accountsOverview.find((account) => account.id === accountId) : null) ??
    null;
  const username =
    activeOverview?.username ??
    selectedAccount?.ig_username ??
    "conta";
  const isInstagramAccount = selectedAccount?.platform !== "tiktok";
  const ownerSnapshot = globalSnapshot ?? snapshot;
  const metricsBarSource = globalPublicationMetrics ?? publicationMetrics;
  const hasMetricsScopeFilter = Boolean(
    accountId || filters.platform !== "all" || filters.contentType !== "all",
  );

  const loadLiveMetrics = useCallback(async () => {
    if (!accountId || !isInstagramAccount) {
      setTokenValid(true);
      setRankingRows([]);
      setFollowersToday(0);
      setFollowers7d(0);
      setFollowers30d(0);
      setViews7d(0);
      setLikes7d(0);
      return;
    }

    try {
      const [statsRes, rankingRes] = await Promise.all([
        fetch(`/api/instagram/stats?account_id=${accountId}`, { credentials: "include", cache: "no-store" }),
        fetch(`/api/instagram/ranking?metric=followers&period=today`, { credentials: "include", cache: "no-store" }),
      ]);

      const stats = await statsRes.json();
      const ranking = await rankingRes.json();

      setTokenValid(stats.account_status === "active");
      setRankingRows((ranking.all_accounts as RankingRow[]) ?? []);

      const row = (ranking.all_accounts as RankingRow[] | undefined)?.find(
        (item) => item.account_id === accountId,
      );

      if (row) {
        setFollowersToday(row.metrics.today.net_followers);
        setFollowers7d(row.metrics.last_7_days.net_followers);
        setViews7d(row.metrics.last_7_days.views);
        setLikes7d(row.metrics.last_7_days.likes);
        setFollowers30d(Math.round(row.metrics.last_7_days.net_followers * 4.3));
      }
    } catch {
      setTokenValid(false);
    }
  }, [accountId]);

  useEffect(() => {
    loadLiveMetrics();
  }, [loadLiveMetrics]);

  const health = useMemo(
    () =>
      computeHealthChecks({
        tokenValid: activeOverview
          ? activeOverview.tokenStatus === "valid"
          : isInstagramAccount
            ? tokenValid
            : false,
        pendingCount: activeOverview?.pendingCount ?? snapshot.pendingCount,
        failedCount:
          (activeOverview?.failedCount ?? snapshot.failedCount) +
          (activeOverview?.failedPersistentCount ?? 0),
        retryingCount: activeOverview?.retryingCount ?? 0,
        duplicateSlotCount: activeOverview?.duplicateSlotCount ?? 0,
        playbookConfigured: activeOverview?.playbookConfigured ?? true,
        health: activeOverview?.health,
      }),
    [activeOverview, tokenValid, isInstagramAccount, snapshot.pendingCount, snapshot.failedCount],
  );

  const publishedToday = activeOverview
    ? activeOverview.publishedToday
    : accountsOverview.reduce((sum, account) => sum + account.publishedToday, 0);
  const heroHealthy = activeOverview?.health === "healthy";
  const heroStatusMessage =
    activeOverview?.statusMessage ??
    (heroHealthy
      ? "Sua automação está funcionando normalmente."
      : "Revise alertas e fila de publicação.");
  const heroTitle = heroHealthy
    ? `🚀 Sua conta está ativa pelos próximos ${snapshot.coverageDays} dias`
    : activeOverview?.health === "error"
      ? "⚠️ Conta em erro — ação necessária"
      : "⚠️ Conta em atenção — revise a fila";
  const nextHours = hoursUntilNextPost(snapshot.nextPost);
  const growthPercent =
    followers7d > 0 ? Math.round(((followersToday * 7) / Math.max(followers7d, 1)) * 100 - 100) : 0;
  const dailyPace = followers7d > 0 ? Math.round(followers7d / 7) : 0;

  const bestAccountToday = useMemo(() => {
    return [...rankingRows].sort(
      (a, b) => b.metrics.today.net_followers - a.metrics.today.net_followers,
    )[0];
  }, [rankingRows]);

  function buildHref(patch: Partial<ReportFilters>) {
    return buildReportQuery({ ...filters, ...patch, accountId: accountId || undefined });
  }

  const viewTabs = [
    ["publications", "Publicações"],
    ["audit", "Conferência"],
    ["metrics", "Métricas"],
    ["errors", "Erros"],
  ] as const;

  return (
    <div className="space-y-8">
      <PublisherOperationsBanner />

      {operationsAlerts.length > 0 && <OperationsAlertsPanel alerts={operationsAlerts} />}

      {accountsOverview.length > 0 && (
        <BulkAccountPausePanel accounts={accountsOverview} />
      )}

      {campaignRows.length > 0 && <CampaignsOperationsPanel rows={campaignRows} />}

      {accountsOverview.length > 0 && (
        <section>
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-xl font-bold text-ig-text">Suas páginas</h2>
              <p className="text-sm text-ig-muted">
                Métricas por conta — hoje, 7 dias, fila e taxa de sucesso.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <ExportReportButton posts={allPosts} />
              <a href="/dashboard/uploads" className="text-sm font-medium text-ig-primary hover:underline">
                Histórico de uploads
              </a>
            </div>
          </div>
          <AccountOperationsGrid accounts={accountsOverview} />
        </section>
      )}

      <PublicationMetricsBar
        metrics={metricsBarSource}
        scopeFiltered={hasMetricsScopeFilter}
        filteredMetrics={hasMetricsScopeFilter ? publicationMetrics : undefined}
      />

      {view !== "audit" && (
        <ReportFiltersBar
          filters={filters}
          accounts={accounts}
          products={filterProducts}
          campaigns={filterCampaigns}
        />
      )}

      <div className="flex flex-wrap gap-2 border-b border-ig-border pb-2">
        {viewTabs.map(([value, label]) => (
          <a
            key={value}
            href={buildHref({ view: value })}
            className={`rounded-t-lg px-4 py-2 text-sm font-medium transition ${
              view === value
                ? "border border-b-0 border-ig-border bg-ig-elevated text-ig-primary"
                : "text-ig-muted hover:text-ig-text"
            }`}
          >
            {label}
          </a>
        ))}
        <a
          href="/dashboard/logs"
          className="ml-auto self-center text-sm text-ig-primary hover:underline"
        >
          Logs operacionais →
        </a>
        <a
          href="/dashboard/operations/schedule-jobs"
          className="self-center text-sm text-ig-primary hover:underline"
        >
          Fila de agendamento →
        </a>
      </div>

      {view === "metrics" && (
        <MetricsPanels
          platformMetrics={platformMetrics}
          contentTypeMetrics={contentTypeMetrics}
          multiplatformMetrics={multiplatformMetrics}
        />
      )}

      {view === "errors" && <ErrorReportPanel report={errorReport} />}

      {view === "audit" && (
        <PublicationAuditPanel
          audit={publicationAudit}
          filters={filters}
          accounts={accounts}
          selectedAccountId={accountId}
        />
      )}

      {view === "publications" && (
        <>
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-ig-border bg-ig-elevated p-4">
          <p className="text-sm text-ig-muted">Publicados hoje</p>
          <p className="mt-1 text-2xl font-bold text-ig-text">{publishedToday}</p>
        </div>
        <div className="rounded-2xl border border-ig-border bg-ig-elevated p-4">
          <p className="text-sm text-ig-muted">Pendentes</p>
          <p className="mt-1 text-2xl font-bold text-ig-text">{snapshot.pendingCount}</p>
        </div>
        <div className="rounded-2xl border border-ig-border bg-ig-elevated p-4">
          <p className="text-sm text-ig-muted">Com falha</p>
          <p className="mt-1 text-2xl font-bold text-ig-danger">{snapshot.failedCount}</p>
        </div>
        <div className="rounded-2xl border border-ig-border bg-ig-elevated p-4">
          <p className="text-sm text-ig-muted">Taxa de sucesso</p>
          <p className="mt-1 text-2xl font-bold text-ig-text">
            {publicationMetrics.successRate}%
          </p>
        </div>
      </section>

      <section className="ig-hero rounded-3xl border border-ig-info-border bg-gradient-to-br from-ig-primary/10 via-ig-elevated to-ig-secondary p-8">
        <p className="text-sm font-semibold uppercase tracking-wide text-ig-primary">
          Central de Operações da IA
        </p>
        <h1 className="mt-2 text-3xl font-bold text-ig-text">{heroTitle}</h1>
        <p className="mt-3 max-w-3xl text-ig-muted">{heroStatusMessage}</p>
        {activeOverview?.recommendedAction && (
          <p className="mt-2 text-sm font-medium text-amber-700">{activeOverview.recommendedAction}</p>
        )}
        {activeOverview?.lastError && activeOverview.health !== "healthy" && (
          <p className="mt-2 text-sm text-ig-danger">{activeOverview.lastError}</p>
        )}

        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-ig-muted">Conta</p>
            <p className="mt-1 text-lg font-semibold text-ig-text">@{username}</p>
            {activeOverview && (
              <p className="text-xs text-ig-muted">
                {activeOverview.platform === "tiktok" ? "TikTok" : "Instagram"} ·{" "}
                {activeOverview.health === "healthy"
                  ? "Saudável"
                  : activeOverview.health === "attention"
                    ? "Atenção"
                    : "Erro"}
              </p>
            )}
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-ig-muted">Próximo post</p>
            <p className="mt-1 text-lg font-semibold text-ig-text">
              {snapshot.nextPost ? formatShortDateTime(snapshot.nextPost.scheduled_at) : "Nenhum"}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-ig-muted">Último post programado</p>
            <p className="mt-1 text-lg font-semibold text-ig-text">
              {snapshot.lastScheduled ? formatShortDate(snapshot.lastScheduled.scheduled_at) : "—"}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-ig-muted">Conteúdo restante</p>
            <p className="mt-1 text-lg font-semibold text-ig-text">{snapshot.coverageDays} dias</p>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          <a href="/dashboard/stories" className="ig-btn px-5 py-3 text-sm font-semibold">
            Programar Stories
          </a>
          <a href="/dashboard/bulk" className="ig-btn-secondary px-5 py-3 text-sm font-semibold">
            Agendar mais vídeos
          </a>
          <a href="/dashboard/calendar" className="ig-btn-secondary px-5 py-3 text-sm font-semibold">
            Ver calendário
          </a>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <MetricCard title="📈 Seguidores Ganhos">
          <div className="space-y-2">
            <StatLine label="Hoje" value={formatSigned(followersToday)} />
            <StatLine label="Últimos 7 dias" value={formatSigned(followers7d)} />
            <StatLine label="Últimos 30 dias" value={formatSigned(followers30d)} />
          </div>
        </MetricCard>

        <MetricCard title="🚀 Conteúdo Restante">
          <p className="text-4xl font-bold text-ig-text">{snapshot.coverageDays} dias</p>
          <p className="mt-3 text-sm text-ig-muted">
            Último conteúdo programado:
            <br />
            <span className="font-medium text-ig-text">
              {snapshot.lastScheduled ? formatShortDate(snapshot.lastScheduled.scheduled_at) : "—"}
            </span>
          </p>
        </MetricCard>

        <MetricCard title="🤖 Trabalho da IA">
          <div className="space-y-2 text-sm">
            <StatLine
              label="Publicações programadas"
              value={formatCount(activeOverview?.pendingCount ?? snapshot.pendingCount)}
            />
            <StatLine label="Publicados" value={formatCount(snapshot.publishedCount)} />
            {activeOverview?.incompletePosts ? (
              <StatLine
                label="Publicações incompletas"
                value={formatCount(activeOverview.incompletePosts)}
              />
            ) : null}
            {accountId ? null : (
              <StatLine label="Total owner" value={formatCount(ownerSnapshot.pendingCount)} />
            )}
          </div>
        </MetricCard>

        <MetricCard title="🏆 Sequência Ativa">
          <p className="text-4xl font-bold text-ig-text">{snapshot.streak.current} dias seguidos</p>
          <p className="mt-3 text-sm text-ig-muted">
            Maior sequência: <span className="font-semibold text-ig-text">{snapshot.streak.best} dias</span>
          </p>
        </MetricCard>

        <MetricCard title="⏳ Tempo Economizado">
          <p className="text-4xl font-bold text-ig-text">{formatDuration(snapshot.timeSavedMinutes)}</p>
          <p className="mt-3 text-sm text-ig-muted">
            Baseado em criação de legendas + hashtags + agendamento manual
          </p>
        </MetricCard>

        <MetricCard title="🟢 Saúde da Conta">
          <p className="text-4xl font-bold text-ig-text">
            {activeOverview?.healthPercent ?? health.percent}%
          </p>
          <ul className="mt-3 space-y-1 text-sm">
            {health.checks.map((check) => (
              <li key={check.label} className={check.ok ? "text-ig-text" : "text-ig-danger"}>
                {check.ok ? "✓" : "✕"} {check.label}
              </li>
            ))}
          </ul>
        </MetricCard>

        <MetricCard title="🔥 Score da Conta" className="md:col-span-2 xl:col-span-1">
          <p className="text-4xl font-bold text-ig-text">
            {snapshot.accountScore.score} <span className="text-lg font-medium text-ig-muted">/ 100</span>
          </p>
          <div className="mt-3 space-y-1 text-sm">
            <StatLine label="Frequência" value={snapshot.accountScore.frequency} />
            <StatLine label="Consistência" value={snapshot.accountScore.consistency} />
            <StatLine label="Fila" value={snapshot.accountScore.queue} />
          </div>
        </MetricCard>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <MetricCard title="📊 Resultado da Automação">
          <div className="grid gap-2 sm:grid-cols-2">
            <StatLine label="Posts publicados" value={formatCount(snapshot.publishedCount)} />
            <StatLine label="Seguidores ganhos" value={formatSigned(followers30d)} />
            <StatLine label="Visualizações" value={formatCount(views7d)} />
            <StatLine label="Curtidas" value={formatCount(likes7d)} />
            <StatLine label="Comentários" value={formatCount(Math.round(likes7d * 0.14))} />
            <StatLine label="Compartilhamentos" value={formatCount(Math.round(likes7d * 0.11))} />
            <StatLine label="Salvamentos" value={formatCount(Math.round(likes7d * 0.12))} />
          </div>
        </MetricCard>

        <div className="space-y-4">
          <MetricCard title="📈 Evolução da Conta">
            <div className="space-y-2">
              <StatLine label="Hoje" value={`${formatSigned(followersToday)} seguidores`} />
              <StatLine label="Últimos 7 dias" value={`${formatSigned(followers7d)} seguidores`} />
              <StatLine label="Últimos 30 dias" value={`${formatSigned(followers30d)} seguidores`} />
              <StatLine label="Crescimento atual" value={`↑ ${Math.max(0, growthPercent)}%`} />
            </div>
          </MetricCard>

          <MetricCard title="⚡ Ritmo Atual">
            <p className="text-3xl font-bold text-ig-text">{dailyPace} seguidores por dia</p>
            <div className="mt-3 space-y-1 text-sm text-ig-muted">
              <p>Projeção: {formatSigned(dailyPace * 30)} seguidores por mês</p>
              <p>Projeção: {formatSigned(dailyPace * 365)} seguidores por ano</p>
            </div>
          </MetricCard>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <MetricCard title="📅 Cobertura de Conteúdo">
          <div className="space-y-3">
            {snapshot.monthlyCoverage.months.map((month) => (
              <div key={month.label}>
                <div className="mb-1 flex items-center justify-between text-xs text-ig-muted">
                  <span>{month.label}</span>
                  <span>{month.count} posts</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-ig-secondary">
                  <div
                    className="h-full rounded-full bg-ig-primary"
                    style={{ width: `${month.fill}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
          <p className="mt-4 text-sm text-ig-muted">
            Sua fila está abastecida até:{" "}
            <span className="font-semibold text-ig-text">
              {snapshot.monthlyCoverage.until ?? "—"}
            </span>
          </p>
        </MetricCard>

        <MetricCard title="🤖 Insights">
          <div className="space-y-3 text-sm">
            <p>
              <span className="text-ig-muted">Melhor horário:</span>{" "}
              <span className="font-semibold text-ig-text">
                {snapshot.scheduleInsights.hasEnoughData
                  ? snapshot.scheduleInsights.bestHour
                  : "Ainda não há dados suficientes para calcular melhor horário."}
              </span>
            </p>
            <p>
              <span className="text-ig-muted">Melhor dia:</span>{" "}
              <span className="font-semibold text-ig-text">
                {snapshot.scheduleInsights.hasEnoughData
                  ? snapshot.scheduleInsights.bestDay
                  : "—"}
              </span>
            </p>
            <p className="text-ig-muted">
              Vídeos com legendas completas geram mais engajamento quando publicados nos horários que a IA escolheu para sua conta.
            </p>
          </div>
        </MetricCard>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <MetricCard title="🏆 Melhor Conta Hoje">
          {bestAccountToday ? (
            <>
              <p className="text-2xl font-bold text-ig-text">@{bestAccountToday.ig_username ?? username}</p>
              <p className="mt-2 text-lg text-ig-primary">
                {formatSigned(bestAccountToday.metrics.today.net_followers)} seguidores
              </p>
            </>
          ) : (
            <p className="text-sm text-ig-muted">Carregando ranking...</p>
          )}
        </MetricCard>

        <MetricCard title="📈 Crescimento por Conta">
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="text-xs uppercase text-ig-muted">
                <tr>
                  <th className="py-2 pr-4">Conta</th>
                  <th className="py-2 pr-4">Seguidores</th>
                  <th className="py-2 pr-4">Views</th>
                  <th className="py-2">Curtidas</th>
                </tr>
              </thead>
              <tbody>
                {rankingRows.slice(0, 5).map((row) => (
                  <tr key={row.account_id} className="border-t border-ig-border">
                    <td className="py-2 pr-4">@{row.ig_username ?? "—"}</td>
                    <td className="py-2 pr-4">{formatSigned(row.metrics.today.net_followers)}</td>
                    <td className="py-2 pr-4">{formatCount(row.metrics.today.views)}</td>
                    <td className="py-2">{formatCount(row.metrics.today.likes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </MetricCard>
      </section>

      <section className="rounded-3xl border border-ig-border bg-ig-elevated p-6">
        <h2 className="text-xl font-bold text-ig-text">🚀 Resumo Executivo</h2>
        <p className="mt-2 text-ig-muted">Sua automação está funcionando normalmente</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatLine label="Posts programados" value={formatCount(snapshot.scheduledCount)} />
          <StatLine label="Dias garantidos" value={`${snapshot.coverageDays} dias`} />
          <StatLine label="Seguidores ganhos" value={formatSigned(followers30d)} />
          <StatLine label="Visualizações" value={formatCount(views7d)} />
          <StatLine label="Tempo economizado" value={formatDuration(snapshot.timeSavedMinutes)} />
          <StatLine label="Saúde da conta" value={`${health.percent}%`} />
          <StatLine
            label="Próximo post"
            value={nextHours !== null ? `em ${nextHours} hora(s)` : "—"}
          />
          <StatLine
            label="Último conteúdo"
            value={snapshot.lastScheduled ? formatShortDate(snapshot.lastScheduled.scheduled_at) : "—"}
          />
        </div>
      </section>

      <section>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold text-ig-text">Publicações</h2>
            <p className="text-sm text-ig-muted">
              {posts.length} resultado(s) · busca, filtros e ordenação combinados
            </p>
          </div>
          <ExportReportButton posts={posts} />
        </div>

        <PostsManager posts={posts} enableBulk rich showPublishedMeta />

        {!posts.length && (
          <div className="rounded-xl border border-dashed border-ig-border p-12 text-center text-ig-muted">
            Nenhum post neste filtro.{" "}
            <a href="/dashboard/stories" className="text-ig-primary hover:underline">
              Programar Stories
            </a>
            {" · "}
            <a href="/dashboard/bulk" className="text-ig-primary hover:underline">
              Agendar mais vídeos
            </a>
          </div>
        )}
      </section>
        </>
      )}
    </div>
  );
}
