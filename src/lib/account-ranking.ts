import type { SupabaseClient } from "@supabase/supabase-js";
import type { InstagramAccount } from "@/lib/types";
import {
  checkInstagramAccountHealth,
  getInstagramAccountStats,
} from "@/lib/meta/instagram";
import { getInstagramAccountInsights } from "@/lib/meta/insights";

export type RankingMetric = "followers" | "views" | "likes";
export type RankingPeriod = "today" | "last_7_days";

export interface AccountRankingRow {
  account_id: string;
  ig_username: string | null;
  profile_picture_url: string | null;
  account_status: "active" | "error";
  followers_count: number;
  metrics: {
    today: {
      views: number;
      likes: number;
      followers_gained: number;
      followers_lost: number;
      net_followers: number;
    };
    last_7_days: {
      views: number;
      likes: number;
      followers_gained: number;
      followers_lost: number;
      net_followers: number;
    };
  };
  insights_available: boolean;
  insights_note?: string;
  rank_score: number;
}

export interface RankingBoard {
  metric: RankingMetric;
  period: RankingPeriod;
  top10: AccountRankingRow[];
  all_accounts: AccountRankingRow[];
  fetched_at: string;
  data_source: "instagram_api";
}

function metricValue(row: AccountRankingRow, metric: RankingMetric, period: RankingPeriod) {
  const bucket = period === "today" ? row.metrics.today : row.metrics.last_7_days;
  if (metric === "followers") return bucket.net_followers;
  if (metric === "views") return bucket.views;
  return bucket.likes;
}

function sortRows(rows: AccountRankingRow[], metric: RankingMetric, period: RankingPeriod) {
  return [...rows].sort((a, b) => {
    const diff = metricValue(b, metric, period) - metricValue(a, metric, period);
    if (diff !== 0) return diff;
    return b.followers_count - a.followers_count;
  });
}

async function getFollowerDeltas(
  supabase: SupabaseClient,
  accountId: string,
  currentFollowers: number,
) {
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data: daySnap } = await supabase
    .from("account_metrics_snapshots")
    .select("followers_count, recorded_at")
    .eq("account_id", accountId)
    .lte("recorded_at", dayAgo)
    .order("recorded_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: weekSnap } = await supabase
    .from("account_metrics_snapshots")
    .select("followers_count, recorded_at")
    .eq("account_id", accountId)
    .lte("recorded_at", weekAgo)
    .order("recorded_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return {
    today: daySnap ? currentFollowers - Number(daySnap.followers_count) : undefined,
    week: weekSnap ? currentFollowers - Number(weekSnap.followers_count) : undefined,
  };
}

async function saveSnapshot(
  supabase: SupabaseClient,
  accountId: string,
  followersCount: number,
) {
  const { error } = await supabase.from("account_metrics_snapshots").insert({
    account_id: accountId,
    followers_count: followersCount,
    recorded_at: new Date().toISOString(),
  });

  if (error && !error.message.includes("account_metrics_snapshots")) {
    console.warn("snapshot insert failed:", error.message);
  }
}

async function fetchAccountRankingRow(
  supabase: SupabaseClient,
  account: InstagramAccount,
): Promise<AccountRankingRow> {
  const provider = account.auth_provider === "facebook" ? "facebook" : "instagram";

  const health = await checkInstagramAccountHealth(account.page_access_token, {
    provider,
    igUserId: account.ig_user_id,
  });

  if (health.status !== "active") {
    return {
      account_id: account.id,
      ig_username: account.ig_username,
      profile_picture_url: account.profile_picture_url,
      account_status: "error",
      followers_count: 0,
      metrics: {
        today: { views: 0, likes: 0, followers_gained: 0, followers_lost: 0, net_followers: 0 },
        last_7_days: {
          views: 0,
          likes: 0,
          followers_gained: 0,
          followers_lost: 0,
          net_followers: 0,
        },
      },
      insights_available: false,
      insights_note: health.message,
      rank_score: 0,
    };
  }

  try {
    const stats = await getInstagramAccountStats(account.page_access_token, {
      provider,
      igUserId: account.ig_user_id,
    });

    await saveSnapshot(supabase, account.id, stats.followers_count);

    const deltas = await getFollowerDeltas(supabase, account.id, stats.followers_count);

    const insights = await getInstagramAccountInsights({
      igUserId: account.ig_user_id,
      token: account.page_access_token,
      provider,
      followersCount: stats.followers_count,
      followersDeltaToday: deltas.today,
      followersDelta7d: deltas.week,
    });

    const row: AccountRankingRow = {
      account_id: account.id,
      ig_username: stats.username ?? account.ig_username,
      profile_picture_url: stats.profile_picture_url ?? account.profile_picture_url,
      account_status: "active",
      followers_count: stats.followers_count,
      metrics: {
        today: insights.today,
        last_7_days: insights.last_7_days,
      },
      insights_available: insights.insights_available,
      insights_note: insights.insights_note,
      rank_score: 0,
    };

    await supabase
      .from("instagram_accounts")
      .update({
        ig_username: row.ig_username,
        profile_picture_url: row.profile_picture_url,
        updated_at: new Date().toISOString(),
      })
      .eq("id", account.id);

    return row;
  } catch (error) {
    return {
      account_id: account.id,
      ig_username: account.ig_username,
      profile_picture_url: account.profile_picture_url,
      account_status: "error",
      followers_count: 0,
      metrics: {
        today: { views: 0, likes: 0, followers_gained: 0, followers_lost: 0, net_followers: 0 },
        last_7_days: {
          views: 0,
          likes: 0,
          followers_gained: 0,
          followers_lost: 0,
          net_followers: 0,
        },
      },
      insights_available: false,
      insights_note: error instanceof Error ? error.message : "Erro ao buscar métricas",
      rank_score: 0,
    };
  }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
) {
  const results: R[] = [];
  let index = 0;

  async function runNext() {
    const current = index++;
    if (current >= items.length) return;
    results[current] = await worker(items[current]);
    await runNext();
  }

  const runners = Array.from({ length: Math.min(concurrency, items.length) }, () => runNext());
  await Promise.all(runners);
  return results;
}

export async function buildAccountsRanking(params: {
  supabase: SupabaseClient;
  accounts: InstagramAccount[];
  metric?: RankingMetric;
  period?: RankingPeriod;
}) {
  const metric = params.metric ?? "followers";
  const period = params.period ?? "today";

  const rows = await mapWithConcurrency(params.accounts, 4, (account) =>
    fetchAccountRankingRow(params.supabase, account),
  );

  const sorted = sortRows(rows, metric, period).map((row, index) => ({
    ...row,
    rank_score: metricValue(row, metric, period),
    position: index + 1,
  }));

  return {
    metric,
    period,
    top10: sorted.slice(0, 10),
    all_accounts: sorted,
    fetched_at: new Date().toISOString(),
    data_source: "instagram_api" as const,
  };
}
