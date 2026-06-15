"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Crown,
  Eye,
  Heart,
  RefreshCw,
  TrendingUp,
  Trophy,
  Users,
} from "lucide-react";
import { formatDateTime } from "@/lib/utils";

type RankingMetric = "followers" | "views" | "likes";
type RankingPeriod = "today" | "last_7_days";

interface RankingRow {
  account_id: string;
  ig_username: string | null;
  profile_picture_url: string | null;
  account_status: "active" | "error";
  followers_count: number;
  metrics: {
    today: MetricBucket;
    last_7_days: MetricBucket;
  };
  insights_available: boolean;
  insights_note?: string;
  rank_score: number;
  position?: number;
}

interface MetricBucket {
  views: number;
  likes: number;
  followers_gained: number;
  followers_lost: number;
  net_followers: number;
}

interface RankingResponse {
  metric: RankingMetric;
  period: RankingPeriod;
  top10: RankingRow[];
  all_accounts: RankingRow[];
  fetched_at: string;
  data_source: string;
  message?: string;
}

const metricLabels: Record<RankingMetric, string> = {
  followers: "Seguidores",
  views: "Views",
  likes: "Likes",
};

const periodLabels: Record<RankingPeriod, string> = {
  today: "Hoje",
  last_7_days: "Últimos 7 dias",
};

function formatNumber(value: number) {
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${new Intl.NumberFormat("pt-BR").format(value)}`;
}

function formatCount(value: number) {
  return new Intl.NumberFormat("pt-BR").format(value);
}

function readMetric(row: RankingRow, metric: RankingMetric, period: RankingPeriod) {
  const bucket = period === "today" ? row.metrics.today : row.metrics.last_7_days;
  if (metric === "followers") return bucket.net_followers;
  if (metric === "views") return bucket.views;
  return bucket.likes;
}

function medalClass(position: number) {
  if (position === 1) return "border-amber-400/50 bg-amber-500/15 text-amber-200";
  if (position === 2) return "border-zinc-300/40 bg-zinc-400/10 text-zinc-200";
  if (position === 3) return "border-orange-400/40 bg-orange-500/10 text-orange-200";
  return "border-white/10 bg-black/20 text-zinc-300";
}

export function AccountsRanking() {
  const [metric, setMetric] = useState<RankingMetric>("followers");
  const [period, setPeriod] = useState<RankingPeriod>("today");
  const [data, setData] = useState<RankingResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchRanking = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(
        `/api/instagram/ranking?metric=${metric}&period=${period}`,
        { credentials: "include", cache: "no-store" },
      );
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error ?? "Falha ao carregar ranking");
      }
      setData(json as RankingResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro desconhecido");
    } finally {
      setLoading(false);
    }
  }, [metric, period]);

  useEffect(() => {
    fetchRanking();
  }, [fetchRanking]);

  const top10 = useMemo(() => data?.top10 ?? [], [data]);
  const allAccounts = useMemo(() => data?.all_accounts ?? [], [data]);

  const MetricIcon =
    metric === "followers" ? Users : metric === "views" ? Eye : Heart;

  return (
    <section className="mb-8 rounded-2xl border border-white/10 bg-gradient-to-br from-purple-500/10 via-pink-500/5 to-transparent p-6">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-purple-500/30 bg-purple-500/10 px-3 py-1 text-xs text-purple-200">
            <Trophy size={14} />
            Dados reais da API do Instagram
          </div>
          <h2 className="text-xl font-bold text-white">Ranking Top 10</h2>
          <p className="mt-1 text-sm text-zinc-400">
            Melhores contas por seguidores ganhos, views e likes — hoje e últimos 7 dias.
          </p>
          {data?.fetched_at && (
            <p className="mt-1 text-xs text-zinc-500">
              Atualizado em {formatDateTime(data.fetched_at)}
            </p>
          )}
        </div>

        <button
          type="button"
          onClick={fetchRanking}
          disabled={loading}
          className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-zinc-200 transition hover:bg-white/10 disabled:opacity-50"
        >
          <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
          Atualizar ranking
        </button>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {(Object.keys(metricLabels) as RankingMetric[]).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setMetric(key)}
            className={`rounded-full px-4 py-2 text-sm transition ${
              metric === key
                ? "bg-pink-500 text-white"
                : "border border-white/10 bg-black/20 text-zinc-300 hover:bg-white/10"
            }`}
          >
            {metricLabels[key]}
          </button>
        ))}
      </div>

      <div className="mb-6 flex flex-wrap gap-2">
        {(Object.keys(periodLabels) as RankingPeriod[]).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setPeriod(key)}
            className={`rounded-full px-4 py-2 text-sm transition ${
              period === key
                ? "bg-purple-500 text-white"
                : "border border-white/10 bg-black/20 text-zinc-300 hover:bg-white/10"
            }`}
          >
            {periodLabels[key]}
          </button>
        ))}
      </div>

      {error && (
        <p className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </p>
      )}

      {data?.message && !allAccounts.length && (
        <p className="rounded-lg border border-white/10 bg-black/20 px-4 py-3 text-sm text-zinc-400">
          {data.message}
        </p>
      )}

      {loading && !top10.length ? (
        <div className="rounded-xl border border-white/10 bg-black/20 p-8 text-center text-zinc-400">
          Buscando métricas reais de todas as contas...
        </div>
      ) : null}

      {!loading && top10.length > 0 && (
        <>
          <div className="mb-6 grid gap-3 md:grid-cols-3">
            {top10.slice(0, 3).map((row, index) => {
              const position = index + 1;
              const value = readMetric(row, metric, period);
              return (
                <article
                  key={row.account_id}
                  className={`rounded-xl border p-4 ${medalClass(position)}`}
                >
                  <div className="mb-3 flex items-center gap-2">
                    {position === 1 ? <Crown size={18} /> : <Trophy size={16} />}
                    <span className="text-sm font-semibold">#{position}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    {row.profile_picture_url ? (
                      <img
                        src={row.profile_picture_url}
                        alt={row.ig_username ?? "Instagram"}
                        className="h-12 w-12 rounded-full border border-white/10 object-cover"
                      />
                    ) : (
                      <div className="flex h-12 w-12 items-center justify-center rounded-full border border-white/10 bg-black/30 text-pink-300">
                        IG
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="truncate font-semibold">@{row.ig_username ?? "conta"}</p>
                      <p className="text-xs opacity-80">
                        {formatCount(row.followers_count)} seguidores totais
                      </p>
                    </div>
                  </div>
                  <p className="mt-3 flex items-center gap-2 text-2xl font-bold">
                    <MetricIcon size={20} />
                    {metric === "followers" ? formatNumber(value) : formatCount(value)}
                  </p>
                </article>
              );
            })}
          </div>

          <div className="overflow-x-auto rounded-xl border border-white/10 bg-black/20">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-white/10 text-xs uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="px-4 py-3">#</th>
                  <th className="px-4 py-3">Conta</th>
                  <th className="px-4 py-3">Seguidores</th>
                  <th className="px-4 py-3">Ganho hoje</th>
                  <th className="px-4 py-3">Ganho 7d</th>
                  <th className="px-4 py-3">Views hoje</th>
                  <th className="px-4 py-3">Views 7d</th>
                  <th className="px-4 py-3">Likes hoje</th>
                  <th className="px-4 py-3">Likes 7d</th>
                  <th className="px-4 py-3">
                    Destaque ({metricLabels[metric]} · {periodLabels[period]})
                  </th>
                </tr>
              </thead>
              <tbody>
                {allAccounts.map((row, index) => {
                  const highlight = readMetric(row, metric, period);
                  const isTop10 = index < 10;
                  return (
                    <tr
                      key={row.account_id}
                      className={`border-b border-white/5 ${
                        isTop10 ? "bg-pink-500/5" : ""
                      } ${row.account_status === "error" ? "opacity-60" : ""}`}
                    >
                      <td className="px-4 py-3 font-medium text-zinc-300">{index + 1}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {row.profile_picture_url ? (
                            <img
                              src={row.profile_picture_url}
                              alt={row.ig_username ?? "Instagram"}
                              className="h-8 w-8 rounded-full border border-white/10 object-cover"
                            />
                          ) : null}
                          <span>@{row.ig_username ?? "—"}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">{formatCount(row.followers_count)}</td>
                      <td className="px-4 py-3 text-emerald-300">
                        {formatNumber(row.metrics.today.net_followers)}
                      </td>
                      <td className="px-4 py-3 text-emerald-300">
                        {formatNumber(row.metrics.last_7_days.net_followers)}
                      </td>
                      <td className="px-4 py-3">{formatCount(row.metrics.today.views)}</td>
                      <td className="px-4 py-3">{formatCount(row.metrics.last_7_days.views)}</td>
                      <td className="px-4 py-3">{formatCount(row.metrics.today.likes)}</td>
                      <td className="px-4 py-3">{formatCount(row.metrics.last_7_days.likes)}</td>
                      <td className="px-4 py-3 font-semibold text-pink-200">
                        <span className="inline-flex items-center gap-1">
                          <TrendingUp size={14} />
                          {metric === "followers"
                            ? formatNumber(highlight)
                            : formatCount(highlight)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      <p className="mt-4 text-xs text-zinc-500">
        Fonte: Instagram Graph API (insights oficiais). Views e likes podem ter atraso de até 48h.
        Ganho de seguidores usa <code className="text-zinc-400">follows_and_unfollows</code> quando
        disponível; abaixo de 100 seguidores, usamos histórico salvo pelo app.
      </p>
    </section>
  );
}
