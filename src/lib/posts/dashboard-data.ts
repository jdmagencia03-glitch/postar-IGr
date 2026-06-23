import type { SupabaseClient } from "@supabase/supabase-js";
import { getOwnerAccountRefs } from "@/lib/posts";
import { isActiveQueueStatus, isHudVisibleStatus } from "@/lib/operations/post-status";
import type { PostStatus, ScheduledPost, SocialPlatform } from "@/lib/types";
import { DB_ROUTE_TIMEOUT_MS, withHardTimeout } from "@/lib/with-timeout";

const DASHBOARD_POST_SELECT =
  "*, instagram_accounts(ig_username, profile_picture_url), tiktok_accounts(username, display_name, profile_picture_url)";

const DASHBOARD_POST_SELECT_MINIMAL = "*";

const HUD_POST_FETCH_LIMIT = 80;

export type DashboardStats = {
  pending: number;
  published: number;
  publishedLast7Days: number;
  failed: number;
};

export type OwnerDashboardData = {
  stats: DashboardStats;
  hudPosts: ScheduledPost[];
  hasScheduledPosts: boolean;
};

type CountFilter = {
  status?: PostStatus;
  statuses?: PostStatus[];
  publishedGte?: string;
};

async function countPostsForIds(
  supabase: SupabaseClient,
  column: "account_id" | "tiktok_account_id",
  ids: string[],
  filter: CountFilter,
): Promise<number | null> {
  if (!ids.length) return 0;

  let query = supabase
    .from("scheduled_posts")
    .select("*", { count: "exact", head: true })
    .in(column, ids);

  if (filter.status) query = query.eq("status", filter.status);
  if (filter.statuses?.length) query = query.in("status", filter.statuses);
  if (filter.publishedGte) query = query.gte("published_at", filter.publishedGte);

  const { count, error } = await query;
  if (error) {
    console.warn("[dashboard-count-failed]", { column, message: error.message });
    return null;
  }

  return count ?? 0;
}

async function countCombined(
  supabase: SupabaseClient,
  igIds: string[],
  ttIds: string[],
  filter: CountFilter,
): Promise<number | null> {
  const [igCount, ttCount] = await Promise.all([
    countPostsForIds(supabase, "account_id", igIds, filter),
    countPostsForIds(supabase, "tiktok_account_id", ttIds, filter),
  ]);

  if (igCount === null || ttCount === null) return null;
  return igCount + ttCount;
}

async function fetchHudPostsForPlatform(
  supabase: SupabaseClient,
  platform: SocialPlatform,
  ids: string[],
): Promise<ScheduledPost[]> {
  if (!ids.length) return [];

  const column = platform === "instagram" ? "account_id" : "tiktok_account_id";

  const run = async (select: string) => {
    const { data, error } = await supabase
      .from("scheduled_posts")
      .select(select)
      .eq("platform", platform)
      .in(column, ids)
      .neq("status", "cancelled")
      .order("scheduled_at", { ascending: true })
      .limit(HUD_POST_FETCH_LIMIT);

    if (error) return null;
    return (data ?? []) as unknown as ScheduledPost[];
  };

  const full = await run(DASHBOARD_POST_SELECT);
  if (full) return full;

  const minimal = await run(DASHBOARD_POST_SELECT_MINIMAL);
  return minimal ?? [];
}

function mergeHudPosts(igPosts: ScheduledPost[], ttPosts: ScheduledPost[]) {
  return [...igPosts, ...ttPosts].sort(
    (a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime(),
  );
}

/** Dashboard: contagens SQL + preview de posts — evita carregar milhares de linhas com joins. */
export async function getOwnerDashboardData(
  supabase: SupabaseClient,
  ownerId: string,
  platformFilter: SocialPlatform | "all",
): Promise<OwnerDashboardData | null> {
  return withHardTimeout(
    (async () => {
      const accountRefs = await getOwnerAccountRefs(supabase, ownerId);
      let igIds = accountRefs.filter((a) => a.platform === "instagram").map((a) => a.id);
      let ttIds = accountRefs.filter((a) => a.platform === "tiktok").map((a) => a.id);

      if (platformFilter === "instagram") ttIds = [];
      if (platformFilter === "tiktok") igIds = [];

      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      const [pendingRetrying, published, publishedLast7, failed, igHudPosts, ttHudPosts] =
        await Promise.all([
          countCombined(supabase, igIds, ttIds, { statuses: ["pending", "retrying"] }),
          countCombined(supabase, igIds, ttIds, { status: "published" }),
          countCombined(supabase, igIds, ttIds, {
            status: "published",
            publishedGte: sevenDaysAgo.toISOString(),
          }),
          countCombined(supabase, igIds, ttIds, { statuses: ["failed", "failed_persistent"] }),
          platformFilter === "tiktok" ? [] : fetchHudPostsForPlatform(supabase, "instagram", igIds),
          platformFilter === "instagram" ? [] : fetchHudPostsForPlatform(supabase, "tiktok", ttIds),
        ]);

      if (
        pendingRetrying === null ||
        published === null ||
        publishedLast7 === null ||
        failed === null
      ) {
        return null;
      }

      const hudPosts = mergeHudPosts(igHudPosts, ttHudPosts).filter((post) =>
        isHudVisibleStatus(post.status),
      );

      const hasScheduledPosts = hudPosts.some(
        (p) =>
          p.status === "pending" ||
          p.status === "published" ||
          p.status === "failed" ||
          p.status === "failed_persistent" ||
          p.status === "retrying" ||
          p.status === "needs_media",
      );

      return {
        stats: {
          pending: pendingRetrying,
          published,
          publishedLast7Days: publishedLast7,
          failed,
        },
        hudPosts,
        hasScheduledPosts,
      };
    })(),
    DB_ROUTE_TIMEOUT_MS,
    null,
    "dashboard-data",
  );
}

export function filterDashboardQueuePosts(hudPosts: ScheduledPost[]) {
  return hudPosts.filter((post) => isActiveQueueStatus(post.status)).slice(0, 12);
}

export type PublisherHealthMetrics = {
  overdue_pending: number;
  stuck_processing: number;
  retrying: number;
  failed_persistent: number;
  pending: number;
  last_publish_at: string | null;
};

/** Métricas do publicador via counts — sem carregar todos os posts. */
export async function getOwnerPublisherHealthMetrics(
  supabase: SupabaseClient,
  ownerId: string,
): Promise<PublisherHealthMetrics | null> {
  return withHardTimeout(
    (async () => {
      const accountRefs = await getOwnerAccountRefs(supabase, ownerId);
      const igIds = accountRefs.filter((a) => a.platform === "instagram").map((a) => a.id);
      const ttIds = accountRefs.filter((a) => a.platform === "tiktok").map((a) => a.id);
      const nowIso = new Date().toISOString();

      const [
        overduePending,
        stuckProcessing,
        retrying,
        failedPersistent,
        pending,
        lastPublishedRow,
      ] = await Promise.all([
        countOverduePending(supabase, igIds, ttIds, nowIso),
        countCombined(supabase, igIds, ttIds, { status: "processing" }),
        countCombined(supabase, igIds, ttIds, { status: "retrying" }),
        countCombined(supabase, igIds, ttIds, { status: "failed_persistent" }),
        countCombined(supabase, igIds, ttIds, { statuses: ["pending", "retrying"] }),
        fetchLastPublishedAt(supabase, igIds, ttIds),
      ]);

      if (
        overduePending === null ||
        stuckProcessing === null ||
        retrying === null ||
        failedPersistent === null ||
        pending === null
      ) {
        return null;
      }

      return {
        overdue_pending: overduePending,
        stuck_processing: stuckProcessing,
        retrying,
        failed_persistent: failedPersistent,
        pending,
        last_publish_at: lastPublishedRow,
      };
    })(),
    DB_ROUTE_TIMEOUT_MS,
    null,
    "publisher-health-metrics",
  );
}

async function countOverduePending(
  supabase: SupabaseClient,
  igIds: string[],
  ttIds: string[],
  nowIso: string,
): Promise<number | null> {
  const countColumn = async (
    column: "account_id" | "tiktok_account_id",
    ids: string[],
  ): Promise<number | null> => {
    if (!ids.length) return 0;
    const { count, error } = await supabase
      .from("scheduled_posts")
      .select("*", { count: "exact", head: true })
      .in(column, ids)
      .eq("status", "pending")
      .lte("scheduled_at", nowIso);
    if (error) return null;
    return count ?? 0;
  };

  const [ig, tt] = await Promise.all([
    countColumn("account_id", igIds),
    countColumn("tiktok_account_id", ttIds),
  ]);
  if (ig === null || tt === null) return null;
  return ig + tt;
}

async function fetchLastPublishedAt(
  supabase: SupabaseClient,
  igIds: string[],
  ttIds: string[],
): Promise<string | null> {
  const fetchLatest = async (column: "account_id" | "tiktok_account_id", ids: string[]) => {
    if (!ids.length) return null;
    const { data, error } = await supabase
      .from("scheduled_posts")
      .select("published_at")
      .in(column, ids)
      .eq("status", "published")
      .not("published_at", "is", null)
      .order("published_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data?.published_at) return null;
    return data.published_at as string;
  };

  const [ig, tt] = await Promise.all([
    fetchLatest("account_id", igIds),
    fetchLatest("tiktok_account_id", ttIds),
  ]);

  if (!ig && !tt) return null;
  if (!ig) return tt;
  if (!tt) return ig;
  return new Date(ig) > new Date(tt) ? ig : tt;
}
