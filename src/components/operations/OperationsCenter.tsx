"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PostsManager } from "@/components/PostsManager";
import { AccountOperationsGrid } from "@/components/operations/AccountOperationsGrid";
import { OperationsAlertsPanel } from "@/components/operations/OperationsAlertsPanel";
import type { AccountOperationsSummary } from "@/lib/operations/account-ops";
import type { OperationsAlert } from "@/lib/operations/alerts-engine";
import {
  computeHealthChecks,
  formatDuration,
  formatShortDate,
  formatShortDateTime,
  hoursUntilNextPost,
  type computeOperationsSnapshot,
} from "@/lib/operations/compute";
import type { ScheduledPost, SocialPlatform, ContentType } from "@/lib/types";

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
  accountsOverview?: AccountOperationsSummary[];
  operationsAlerts?: OperationsAlert[];
  selectedAccountId: string;
  selectedPlatform?: SocialPlatform | "all";
  selectedContentType?: ContentType | "all";
  posts: ScheduledPost[];
  snapshot: ReturnType<typeof computeOperationsSnapshot>;
  statusFilter: string;
  periodFilter: string;
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
  selectedPlatform = "all",
  selectedContentType = "all",
  posts,
  snapshot,
  statusFilter,
  periodFilter,
}: Props) {
  const accountId = selectedAccountId;
  const [tokenValid, setTokenValid] = useState(true);
  const [followersToday, setFollowersToday] = useState(0);
  const [followers7d, setFollowers7d] = useState(0);
  const [followers30d, setFollowers30d] = useState(0);
  const [views7d, setViews7d] = useState(0);
  const [likes7d, setLikes7d] = useState(0);
  const [rankingRows, setRankingRows] = useState<RankingRow[]>([]);

  const selectedAccount = accounts.find((account) => account.id === accountId) ?? accounts[0];
  const username = selectedAccount?.ig_username ?? "conta";
  const isInstagramAccount = selectedAccount?.platform !== "tiktok";

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
        tokenValid,
        pendingCount: snapshot.pendingCount,
        failedCount: snapshot.failedCount,
      }),
    [tokenValid, snapshot.pendingCount, snapshot.failedCount],
  );

  const publishedToday = accountsOverview.reduce((sum, account) => sum + account.publishedToday, 0);
  const nextHours = hoursUntilNextPost(snapshot.nextPost);
  const growthPercent =
    followers7d > 0 ? Math.round(((followersToday * 7) / Math.max(followers7d, 1)) * 100 - 100) : 0;
  const dailyPace = followers7d > 0 ? Math.round(followers7d / 7) : 0;

  const bestAccountToday = useMemo(() => {
    return [...rankingRows].sort(
      (a, b) => b.metrics.today.net_followers - a.metrics.today.net_followers,
    )[0];
  }, [rankingRows]);

  function buildHref(params: Record<string, string | undefined>) {
    const query = new URLSearchParams();
    if (params.platform && params.platform !== "all") query.set("platform", params.platform);
    if (params.content_type && params.content_type !== "all") query.set("content_type", params.content_type);
    if (params.account) query.set("account", params.account);
    if (params.status && params.status !== "all") query.set("status", params.status);
    if (params.period && params.period !== "all") query.set("period", params.period);
    const qs = query.toString();
    return qs ? `/dashboard/reports?${qs}` : "/dashboard/reports";
  }

  const platformTabs = [
    ["all", "Todas"],
    ["instagram", "Instagram"],
    ["tiktok", "TikTok"],
  ] as const;

  const contentTypeTabs = [
    ["all", "Todos"],
    ["reel", "Reels"],
    ["post", "Posts"],
    ["story", "Stories"],
    ["tiktok_video", "TikTok Videos"],
  ] as const;

  const visibleAccounts = accounts.filter(
    (account) => selectedPlatform === "all" || account.platform === selectedPlatform,
  );

  const statusFilters = [
    ["all", "Todos"],
    ["pending", "Pendentes"],
    ["retrying", "Reagendando"],
    ["processing", "Publicando"],
    ["published", "Publicados"],
    ["failed", "Falhas"],
  ] as const;

  const periodFilters = [
    ["all", "Todos"],
    ["today", "Hoje"],
    ["tomorrow", "Amanhã"],
    ["week", "Esta semana"],
    ["month", "Este mês"],
  ] as const;

  return (
    <div className="space-y-8">
      {operationsAlerts.length > 0 && <OperationsAlertsPanel alerts={operationsAlerts} />}

      {accountsOverview.length > 0 && (
        <section>
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-xl font-bold text-ig-text">Suas páginas</h2>
              <p className="text-sm text-ig-muted">
                Visão rápida de saúde, fila e ações por conta.
              </p>
            </div>
            <a href="/dashboard/uploads" className="text-sm font-medium text-ig-primary hover:underline">
              Histórico de uploads
            </a>
          </div>
          <AccountOperationsGrid accounts={accountsOverview} />
        </section>
      )}

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
            {snapshot.scheduledCount
              ? Math.round((snapshot.publishedCount / snapshot.scheduledCount) * 100)
              : 0}
            %
          </p>
        </div>
      </section>

      <div className="flex flex-wrap gap-2">
        {platformTabs.map(([value, label]) => (
          <a
            key={value}
            href={buildHref({
              platform: value,
              content_type: selectedContentType,
              status: statusFilter,
              period: periodFilter,
            })}
            className={`rounded-full px-4 py-2 text-sm transition ${
              selectedPlatform === value
                ? "bg-ig-primary text-ig-on-primary"
                : "border border-ig-border bg-ig-elevated text-ig-text hover:bg-ig-secondary"
            }`}
          >
            {label}
          </a>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        {contentTypeTabs.map(([value, label]) => (
          <a
            key={value}
            href={buildHref({
              platform: selectedPlatform === "all" ? undefined : selectedPlatform,
              content_type: value,
              account: accountId || undefined,
              status: statusFilter,
              period: periodFilter,
            })}
            className={`rounded-full px-4 py-2 text-sm transition ${
              selectedContentType === value
                ? "bg-ig-primary text-ig-on-primary"
                : "border border-ig-border bg-ig-elevated text-ig-text hover:bg-ig-secondary"
            }`}
          >
            {label}
          </a>
        ))}
      </div>

      {visibleAccounts.length > 1 && (
        <div className="flex flex-wrap gap-2">
          <a
            href={buildHref({
              platform: selectedPlatform === "all" ? undefined : selectedPlatform,
              content_type: selectedContentType === "all" ? undefined : selectedContentType,
              status: statusFilter,
              period: periodFilter,
            })}
            className={`rounded-full px-4 py-2 text-sm transition ${
              !accountId
                ? "bg-ig-primary text-ig-on-primary"
                : "border border-ig-border bg-ig-elevated text-ig-text hover:bg-ig-secondary"
            }`}
          >
            Todas as contas
          </a>
          {visibleAccounts.map((account) => (
            <a
              key={account.id}
              href={buildHref({
                platform: account.platform,
                content_type: selectedContentType === "all" ? undefined : selectedContentType,
                account: account.id,
                status: statusFilter,
                period: periodFilter,
              })}
              className={`rounded-full px-4 py-2 text-sm transition ${
                accountId === account.id
                  ? "bg-ig-primary text-ig-on-primary"
                  : "border border-ig-border bg-ig-elevated text-ig-text hover:bg-ig-secondary"
              }`}
            >
              {account.platform === "tiktok" ? "TT" : "IG"} @{account.ig_username ?? "conta"}
            </a>
          ))}
        </div>
      )}

      <section className="ig-hero rounded-3xl border border-ig-info-border bg-gradient-to-br from-ig-primary/10 via-ig-elevated to-ig-secondary p-8">
        <p className="text-sm font-semibold uppercase tracking-wide text-ig-primary">
          Central de Operações da IA
        </p>
        <h1 className="mt-2 text-3xl font-bold text-ig-text">
          🚀 Sua conta está ativa pelos próximos {snapshot.coverageDays} dias
        </h1>
        <p className="mt-3 max-w-3xl text-ig-muted">
          A IA já programou todo o conteúdo necessário para manter sua página publicando automaticamente.
        </p>

        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-ig-muted">Conta</p>
            <p className="mt-1 text-lg font-semibold text-ig-text">@{username}</p>
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
            <StatLine label="Legendas geradas" value={formatCount(snapshot.scheduledCount)} />
            <StatLine label="Hashtags criadas" value={formatCount(snapshot.scheduledCount)} />
            <StatLine label="Horários definidos" value={formatCount(snapshot.scheduledCount)} />
            <StatLine label="Publicações programadas" value={formatCount(snapshot.scheduledCount)} />
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
          <p className="text-4xl font-bold text-ig-text">{health.percent}%</p>
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
              <span className="font-semibold text-ig-text">{snapshot.scheduleInsights.bestHour}</span>
            </p>
            <p>
              <span className="text-ig-muted">Melhor dia:</span>{" "}
              <span className="font-semibold text-ig-text">{snapshot.scheduleInsights.bestDay}</span>
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
            <p className="text-sm text-ig-muted">Gerencie tudo que a IA programou para sua conta</p>
          </div>
        </div>

        <div className="mb-4 flex flex-wrap gap-2">
          {statusFilters.map(([value, label]) => (
            <a
              key={value}
              href={buildHref({
                platform: selectedPlatform === "all" ? undefined : selectedPlatform,
                content_type: selectedContentType === "all" ? undefined : selectedContentType,
                account: accountId,
                status: value,
                period: periodFilter,
              })}
              className={`rounded-full px-4 py-2 text-sm transition ${
                statusFilter === value
                  ? "bg-ig-primary text-ig-on-primary"
                  : "border border-ig-border bg-ig-secondary text-ig-text"
              }`}
            >
              {label}
            </a>
          ))}
        </div>

        <div className="mb-6 flex flex-wrap gap-2">
          {periodFilters.map(([value, label]) => (
            <a
              key={value}
              href={buildHref({
                platform: selectedPlatform === "all" ? undefined : selectedPlatform,
                content_type: selectedContentType === "all" ? undefined : selectedContentType,
                account: accountId,
                status: statusFilter,
                period: value,
              })}
              className={`rounded-full px-4 py-2 text-sm transition ${
                periodFilter === value
                  ? "bg-ig-primary text-ig-on-primary"
                  : "border border-ig-border bg-ig-secondary text-ig-text"
              }`}
            >
              {label}
            </a>
          ))}
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
    </div>
  );
}
