import type { AuthProvider } from "@/lib/meta/instagram";

const GRAPH_VERSION = "v21.0";
const BR_TZ_OFFSET_HOURS = -3;

function getGraphBase(provider: AuthProvider = "instagram") {
  return provider === "facebook"
    ? `https://graph.facebook.com/${GRAPH_VERSION}`
    : `https://graph.instagram.com/${GRAPH_VERSION}`;
}

interface InsightValue {
  value?: number;
  breakdowns?: Array<{
    results?: Array<{
      dimension_values?: string[];
      value?: number;
    }>;
  }>;
  total_value?: {
    value?: number;
    breakdowns?: Array<{
      dimension_keys?: string[];
      results?: Array<{
        dimension_values?: string[];
        value?: number;
      }>;
    }>;
  };
}

interface InsightsResponse {
  data?: Array<{
    name: string;
    total_value?: InsightValue["total_value"];
    values?: Array<{ value?: number; end_time?: string }>;
  }>;
  error?: { message?: string; code?: number };
}

export interface PeriodMetrics {
  views: number;
  likes: number;
  followers_gained: number;
  followers_lost: number;
  net_followers: number;
}

export interface AccountInsightsBundle {
  followers_count: number;
  today: PeriodMetrics;
  last_7_days: PeriodMetrics;
  insights_available: boolean;
  insights_note?: string;
}

function brDayUnixRange(daysBackStart: number, daysBackEnd = 0) {
  const now = new Date();
  const brNowMs = now.getTime() + BR_TZ_OFFSET_HOURS * 3_600_000;
  const brDate = new Date(brNowMs);

  const startDay = new Date(
    Date.UTC(brDate.getUTCFullYear(), brDate.getUTCMonth(), brDate.getUTCDate() - daysBackStart),
  );
  const endDay = new Date(
    Date.UTC(
      brDate.getUTCFullYear(),
      brDate.getUTCMonth(),
      brDate.getUTCDate() - daysBackEnd + 1,
    ),
  );

  const since = Math.floor((startDay.getTime() - BR_TZ_OFFSET_HOURS * 3_600_000) / 1000);
  const until = Math.floor((endDay.getTime() - BR_TZ_OFFSET_HOURS * 3_600_000) / 1000);

  return { since, until };
}

function emptyMetrics(): PeriodMetrics {
  return {
    views: 0,
    likes: 0,
    followers_gained: 0,
    followers_lost: 0,
    net_followers: 0,
  };
}

function readTotalValue(data: InsightsResponse, metricName: string) {
  const entry = data.data?.find((item) => item.name === metricName);
  return Number(entry?.total_value?.value ?? 0);
}

function readFollowBreakdown(data: InsightsResponse) {
  const entry = data.data?.find((item) => item.name === "follows_and_unfollows");
  const breakdowns = entry?.total_value?.breakdowns ?? [];
  let gained = 0;
  let lost = 0;

  for (const breakdown of breakdowns) {
    for (const result of breakdown.results ?? []) {
      const key = (result.dimension_values ?? []).join(":").toUpperCase();
      const value = Number(result.value ?? 0);
      if (key.includes("FOLLOWER") && !key.includes("NON")) {
        gained += value;
      }
      if (key.includes("UNFOLLOW") || key.includes("NON_FOLLOWER")) {
        lost += value;
      }
    }
  }

  if (gained === 0 && lost === 0) {
    const total = Number(entry?.total_value?.value ?? 0);
    if (total > 0) gained = total;
  }

  return { gained, lost, net: gained - lost };
}

async function fetchInsights(params: {
  igUserId: string;
  token: string;
  provider: AuthProvider;
  metrics: string[];
  since: number;
  until: number;
  breakdown?: string;
}) {
  const graph = getGraphBase(params.provider);
  const search = new URLSearchParams({
    metric: params.metrics.join(","),
    period: "day",
    metric_type: "total_value",
    since: String(params.since),
    until: String(params.until),
    access_token: params.token,
  });

  if (params.breakdown) {
    search.set("breakdown", params.breakdown);
  }

  const res = await fetch(`${graph}/${params.igUserId}/insights?${search.toString()}`, {
    cache: "no-store",
  });
  const data = (await res.json()) as InsightsResponse;

  if (!res.ok) {
    throw new Error(data.error?.message ?? "Insights indisponíveis");
  }

  return data;
}

export async function getInstagramAccountInsights(params: {
  igUserId: string;
  token: string;
  provider?: AuthProvider;
  followersCount: number;
  followersDeltaToday?: number;
  followersDelta7d?: number;
}): Promise<AccountInsightsBundle> {
  const provider = params.provider ?? "instagram";
  const todayRange = brDayUnixRange(0, 0);
  const weekRange = brDayUnixRange(6, 0);

  const result: AccountInsightsBundle = {
    followers_count: params.followersCount,
    today: emptyMetrics(),
    last_7_days: emptyMetrics(),
    insights_available: false,
  };

  try {
    const [todayEngagement, weekEngagement, todayFollows, weekFollows] = await Promise.all([
      fetchInsights({
        igUserId: params.igUserId,
        token: params.token,
        provider,
        metrics: ["views", "likes"],
        since: todayRange.since,
        until: todayRange.until,
      }),
      fetchInsights({
        igUserId: params.igUserId,
        token: params.token,
        provider,
        metrics: ["views", "likes"],
        since: weekRange.since,
        until: weekRange.until,
      }),
      fetchInsights({
        igUserId: params.igUserId,
        token: params.token,
        provider,
        metrics: ["follows_and_unfollows"],
        since: todayRange.since,
        until: todayRange.until,
        breakdown: "follow_type",
      }).catch(() => null),
      fetchInsights({
        igUserId: params.igUserId,
        token: params.token,
        provider,
        metrics: ["follows_and_unfollows"],
        since: weekRange.since,
        until: weekRange.until,
        breakdown: "follow_type",
      }).catch(() => null),
    ]);

    result.insights_available = true;
    result.today.views = readTotalValue(todayEngagement, "views");
    result.today.likes = readTotalValue(todayEngagement, "likes");
    result.last_7_days.views = readTotalValue(weekEngagement, "views");
    result.last_7_days.likes = readTotalValue(weekEngagement, "likes");

    if (todayFollows) {
      const follow = readFollowBreakdown(todayFollows);
      result.today.followers_gained = follow.gained;
      result.today.followers_lost = follow.lost;
      result.today.net_followers = follow.net;
    }

    if (weekFollows) {
      const follow = readFollowBreakdown(weekFollows);
      result.last_7_days.followers_gained = follow.gained;
      result.last_7_days.followers_lost = follow.lost;
      result.last_7_days.net_followers = follow.net;
    }
  } catch (error) {
    result.insights_note =
      error instanceof Error ? error.message : "Insights não disponíveis para esta conta";
  }

  if (
    result.today.net_followers === 0 &&
    params.followersDeltaToday !== undefined &&
    params.followersDeltaToday !== 0
  ) {
    result.today.net_followers = params.followersDeltaToday;
    result.today.followers_gained = Math.max(0, params.followersDeltaToday);
    result.today.followers_lost = Math.max(0, -params.followersDeltaToday);
    result.insights_note =
      result.insights_note ??
      "Ganho de seguidores estimado por histórico (conta com menos de 100 seguidores ou API sem follows_and_unfollows).";
  }

  if (
    result.last_7_days.net_followers === 0 &&
    params.followersDelta7d !== undefined &&
    params.followersDelta7d !== 0
  ) {
    result.last_7_days.net_followers = params.followersDelta7d;
    result.last_7_days.followers_gained = Math.max(0, params.followersDelta7d);
    result.last_7_days.followers_lost = Math.max(0, -params.followersDelta7d);
  }

  return result;
}
