import type { SupabaseClient } from "@supabase/supabase-js";
import { getOwnerAccounts } from "@/lib/accounts";
import { getOwnerTikTokAccounts } from "@/lib/tiktok/accounts";
import {
  filterPostsForCalendarView,
  getCalendarStatusesForView,
  normalizeCalendarView,
} from "@/lib/calendar/status";
import { zonedDateTimeToUtc } from "@/lib/timezone";
import type {
  PostStatus,
  PublishLog,
  ScheduledPost,
  ScheduledPostWithAccountSecrets,
  SocialPlatform,
  ContentType,
} from "@/lib/types";

const POST_SELECT_PUBLIC =
  "*, instagram_accounts(ig_username, profile_picture_url), tiktok_accounts(username, display_name, profile_picture_url), products(id, name, main_cta), campaigns(id, name, default_cta, objective)";

/** Fallback quando joins opcionais (products/campaigns) falham no PostgREST. */
const POST_SELECT_OWNER =
  "*, instagram_accounts(ig_username, profile_picture_url), tiktok_accounts(username, display_name, profile_picture_url)";

const POST_SELECT_MINIMAL = "*";

/** Consulta completa para logs quando todas as migrations estão aplicadas. */
const POST_SELECT_LOGS_FULL =
  "id, platform, account_id, tiktok_account_id, caption, scheduled_at, content_type, media_type, instagram_accounts(ig_username), tiktok_accounts(username, display_name)";

/** Fallback sem colunas/joins opcionais de TikTok e content_type. */
const POST_SELECT_LOGS_IG =
  "id, account_id, caption, scheduled_at, media_type, instagram_accounts(ig_username)";

const POST_SELECT_LOGS_TT =
  "id, platform, account_id, tiktok_account_id, caption, scheduled_at, media_type, tiktok_accounts(username, display_name)";

const POST_SELECT_LOGS_MINIMAL = "id, account_id, tiktok_account_id, caption, scheduled_at, media_type";

const LOGS_POST_LIMIT = 400;
const LOGS_FETCH_CHUNK = 60;

const POST_SELECT_SECRETS =
  "*, instagram_accounts(ig_username, profile_picture_url, ig_user_id, page_access_token, auth_provider), tiktok_accounts(username, display_name, profile_picture_url)";

export interface OwnerPostFilters {
  platform?: SocialPlatform | "all";
  accountId?: string;
  contentType?: ContentType | "all";
  status?: PostStatus;
  hiddenFromReport?: boolean;
  limit?: number;
  order?: "asc" | "desc";
}

export interface OwnerAccountRef {
  id: string;
  platform: SocialPlatform;
  username: string | null;
  profile_picture_url: string | null;
}

export async function getOwnerAccountRefs(
  supabase: SupabaseClient,
  ownerId: string,
): Promise<OwnerAccountRef[]> {
  const [igAccounts, tiktokAccounts] = await Promise.all([
    getOwnerAccounts(supabase, ownerId),
    getOwnerTikTokAccounts(supabase, ownerId),
  ]);

  return [
    ...igAccounts.map((account) => ({
      id: account.id,
      platform: "instagram" as const,
      username: account.ig_username,
      profile_picture_url: account.profile_picture_url,
    })),
    ...tiktokAccounts.map((account) => ({
      id: account.id,
      platform: "tiktok" as const,
      username: account.username ?? account.display_name,
      profile_picture_url: account.profile_picture_url,
    })),
  ];
}

function mergePosts(posts: ScheduledPost[], order: "asc" | "desc") {
  return [...posts].sort((a, b) => {
    const diff = new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime();
    return order === "asc" ? diff : -diff;
  });
}

async function queryInstagramPosts(
  supabase: SupabaseClient,
  igIds: string[],
  filters: OwnerPostFilters,
) {
  if (!igIds.length) return [] as ScheduledPost[];

  const run = (select: string) => {
    let query = supabase
      .from("scheduled_posts")
      .select(select)
      .eq("platform", "instagram")
      .in("account_id", igIds);
    if (filters.status) query = query.eq("status", filters.status);
    if (filters.hiddenFromReport === false) query = query.eq("hidden_from_report", false);
    return query;
  };

  const full = await run(POST_SELECT_PUBLIC);
  if (!full.error) return ((full.data ?? []) as unknown as ScheduledPost[]);

  console.warn("[posts] instagram query fallback (public select failed):", full.error.message);

  const owner = await run(POST_SELECT_OWNER);
  if (!owner.error) return ((owner.data ?? []) as unknown as ScheduledPost[]);

  const minimal = await run(POST_SELECT_MINIMAL);
  if (!minimal.error) return ((minimal.data ?? []) as unknown as ScheduledPost[]);

  console.error("[posts] instagram query failed:", minimal.error?.message ?? full.error.message);
  return [];
}

async function queryTikTokPosts(
  supabase: SupabaseClient,
  ttIds: string[],
  filters: OwnerPostFilters,
) {
  if (!ttIds.length) return [] as ScheduledPost[];

  const run = (select: string) => {
    let query = supabase
      .from("scheduled_posts")
      .select(select)
      .eq("platform", "tiktok")
      .in("tiktok_account_id", ttIds);
    if (filters.status) query = query.eq("status", filters.status);
    if (filters.hiddenFromReport === false) query = query.eq("hidden_from_report", false);
    return query;
  };

  const full = await run(POST_SELECT_PUBLIC);
  if (!full.error) return ((full.data ?? []) as unknown as ScheduledPost[]);

  console.warn("[posts] tiktok query fallback (public select failed):", full.error.message);

  const owner = await run(POST_SELECT_OWNER);
  if (!owner.error) return ((owner.data ?? []) as unknown as ScheduledPost[]);

  const minimal = await run(POST_SELECT_MINIMAL);
  if (!minimal.error) return ((minimal.data ?? []) as unknown as ScheduledPost[]);

  console.error("[posts] tiktok query failed:", minimal.error?.message ?? full.error.message);
  return [];
}

function dedupePosts(posts: ScheduledPost[]) {
  const seen = new Set<string>();
  const out: ScheduledPost[] = [];
  for (const post of posts) {
    if (seen.has(post.id)) continue;
    seen.add(post.id);
    out.push(post);
  }
  return out;
}

/** Posts do lote do owner — fallback quando account_id não bate na listagem. */
async function queryPostsByOwnerUploadBatches(
  supabase: SupabaseClient,
  ownerId: string,
  filters: OwnerPostFilters,
) {
  const { data: batches, error: batchError } = await supabase
    .from("upload_batches")
    .select("id")
    .eq("owner_id", ownerId);

  if (batchError || !batches?.length) return [] as ScheduledPost[];

  const batchIds = batches.map((row) => row.id as string);
  const selects = [POST_SELECT_PUBLIC, POST_SELECT_OWNER, POST_SELECT_MINIMAL];

  for (const select of selects) {
    let query = supabase
      .from("scheduled_posts")
      .select(select)
      .in("upload_batch_id", batchIds);
    if (filters.status) query = query.eq("status", filters.status);
    if (filters.hiddenFromReport === false) query = query.eq("hidden_from_report", false);

    const { data, error } = await query;
    if (!error) return ((data ?? []) as unknown as ScheduledPost[]);
  }

  return [];
}

/** Sem filtro platform (DB legado sem coluna platform). */
async function queryInstagramPostsLegacy(
  supabase: SupabaseClient,
  igIds: string[],
  filters: OwnerPostFilters,
) {
  if (!igIds.length) return [] as ScheduledPost[];

  let query = supabase
    .from("scheduled_posts")
    .select(POST_SELECT_MINIMAL)
    .in("account_id", igIds);
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.hiddenFromReport === false) query = query.eq("hidden_from_report", false);

  const { data, error } = await query;
  if (error) return [] as ScheduledPost[];
  return ((data ?? []) as unknown as ScheduledPost[]).map((post) => ({
    ...post,
    platform: post.platform ?? "instagram",
  }));
}

export async function getOwnerScheduledPosts(
  supabase: SupabaseClient,
  ownerId: string,
  filters: OwnerPostFilters = {},
): Promise<ScheduledPost[]> {
  const platform = filters.platform ?? "all";
  const order = filters.order ?? "asc";
  const accountRefs = await getOwnerAccountRefs(supabase, ownerId);

  let igIds = accountRefs.filter((a) => a.platform === "instagram").map((a) => a.id);
  let ttIds = accountRefs.filter((a) => a.platform === "tiktok").map((a) => a.id);

  if (filters.accountId) {
    const selected = accountRefs.find((a) => a.id === filters.accountId);
    if (!selected) return [];
    if (selected.platform === "instagram") {
      igIds = [selected.id];
      ttIds = [];
    } else {
      ttIds = [selected.id];
      igIds = [];
    }
  } else if (platform === "instagram") {
    ttIds = [];
  } else if (platform === "tiktok") {
    igIds = [];
  }

  const [igPosts, ttPosts, batchPosts, igLegacyPosts] = await Promise.all([
    platform === "tiktok" ? [] : queryInstagramPosts(supabase, igIds, filters),
    platform === "instagram" ? [] : queryTikTokPosts(supabase, ttIds, filters),
    platform === "tiktok" ? [] : queryPostsByOwnerUploadBatches(supabase, ownerId, filters),
    platform === "tiktok" ? [] : queryInstagramPostsLegacy(supabase, igIds, filters),
  ]);

  const merged = mergePosts(
    dedupePosts([...igPosts, ...ttPosts, ...batchPosts, ...igLegacyPosts]),
    order,
  );

  let filtered = merged;
  if (filters.contentType && filters.contentType !== "all") {
    filtered = filtered.filter(
      (post) => (post.content_type ?? "reel") === filters.contentType,
    );
  }

  if (filters.limit && filters.limit > 0) {
    return filtered.slice(0, filters.limit);
  }

  return filtered;
}

export type CalendarMonthView = "active" | "all" | "pending" | "published" | "cancelled";

const CALENDAR_CANCELLED_LIMIT = 800;
const CALENDAR_MONTH_LIMIT = 3000;

function calendarMonthUtcRange(monthYyyyMm: string) {
  const [year, month] = monthYyyyMm.split("-").map(Number);
  const start = zonedDateTimeToUtc(year, month, 1, 0, 0);
  const endMonth = month === 12 ? 1 : month + 1;
  const endYear = month === 12 ? year + 1 : year;
  const end = zonedDateTimeToUtc(endYear, endMonth, 1, 0, 0);
  return { start, end };
}

/** Posts do calendário limitados ao mês exibido (evita carregar milhares de cancelados). */
export async function getOwnerPostsForCalendarMonth(
  supabase: SupabaseClient,
  ownerId: string,
  params: {
    month: string;
    platform?: SocialPlatform | "all";
    accountId?: string;
    view?: CalendarMonthView;
  },
): Promise<{ posts: ScheduledPost[]; truncated: boolean }> {
  const view = params.view ?? "active";
  const normalizedView = normalizeCalendarView(view);
  const { start, end } = calendarMonthUtcRange(params.month);
  const limit =
    normalizedView === "cancelled"
      ? CALENDAR_CANCELLED_LIMIT
      : CALENDAR_MONTH_LIMIT;

  const accountRefs = await getOwnerAccountRefs(supabase, ownerId);
  let igIds = accountRefs.filter((a) => a.platform === "instagram").map((a) => a.id);
  let ttIds = accountRefs.filter((a) => a.platform === "tiktok").map((a) => a.id);

  if (params.accountId) {
    const selected = accountRefs.find((a) => a.id === params.accountId);
    if (!selected) return { posts: [], truncated: false };
    if (selected.platform === "instagram") {
      igIds = [selected.id];
      ttIds = [];
    } else {
      ttIds = [selected.id];
      igIds = [];
    }
  } else if (params.platform === "instagram") {
    ttIds = [];
  } else if (params.platform === "tiktok") {
    igIds = [];
  }

  const rangeFilter = {
    gte: start.toISOString(),
    lt: end.toISOString(),
  };

  async function queryPlatform(
    platform: "instagram" | "tiktok",
    ids: string[],
  ): Promise<ScheduledPost[]> {
    if (!ids.length) return [];

    let query = supabase
      .from("scheduled_posts")
      .select(POST_SELECT_MINIMAL)
      .eq("platform", platform)
      .gte("scheduled_at", rangeFilter.gte)
      .lt("scheduled_at", rangeFilter.lt)
      .order("scheduled_at", { ascending: true })
      .limit(limit + 1);

    if (platform === "tiktok") {
      query = query.in("tiktok_account_id", ids);
    } else {
      query = query.in("account_id", ids);
    }

    const statuses = getCalendarStatusesForView(view);
    if (statuses.length === 1) {
      query = query.eq("status", statuses[0]!);
    } else {
      query = query.in("status", [...statuses]);
    }

    const { data, error } = await query;
    if (error) {
      console.error("[calendar-posts] query failed:", error.message);
      return [];
    }

    return ((data ?? []) as unknown as ScheduledPost[]).map((post) => ({
      ...post,
      platform: post.platform ?? platform,
    }));
  }

  const [igPosts, ttPosts] = await Promise.all([
    params.platform === "tiktok" ? [] : queryPlatform("instagram", igIds),
    params.platform === "instagram" ? [] : queryPlatform("tiktok", ttIds),
  ]);

  let merged = dedupePosts([...igPosts, ...ttPosts]).sort(
    (a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime(),
  );

  merged = filterPostsForCalendarView(merged, view);

  const truncated = merged.length > limit;
  return { posts: merged.slice(0, limit), truncated };
}

function tagInstagramPosts(posts: ScheduledPost[]) {
  return posts.map((post) => ({ ...post, platform: post.platform ?? "instagram" }));
}

function tagTikTokPosts(posts: ScheduledPost[]) {
  return posts.map((post) => ({ ...post, platform: post.platform ?? "tiktok" }));
}

async function queryInstagramPostsForLogs(
  supabase: SupabaseClient,
  igIds: string[],
  limit: number,
): Promise<{ posts: ScheduledPost[]; error: string | null }> {
  const full = await supabase
    .from("scheduled_posts")
    .select(POST_SELECT_LOGS_FULL)
    .eq("platform", "instagram")
    .in("account_id", igIds)
    .order("scheduled_at", { ascending: false })
    .limit(limit);
  if (!full.error) {
    return { posts: tagInstagramPosts((full.data ?? []) as unknown as ScheduledPost[]), error: null };
  }

  const legacy = await supabase
    .from("scheduled_posts")
    .select(POST_SELECT_LOGS_IG)
    .in("account_id", igIds)
    .order("scheduled_at", { ascending: false })
    .limit(limit);
  if (!legacy.error) {
    return { posts: tagInstagramPosts((legacy.data ?? []) as unknown as ScheduledPost[]), error: null };
  }

  const minimal = await supabase
    .from("scheduled_posts")
    .select(POST_SELECT_LOGS_MINIMAL)
    .in("account_id", igIds)
    .order("scheduled_at", { ascending: false })
    .limit(limit);
  if (!minimal.error) {
    return { posts: tagInstagramPosts((minimal.data ?? []) as unknown as ScheduledPost[]), error: null };
  }

  return { posts: [], error: minimal.error.message };
}

async function queryTikTokPostsForLogs(
  supabase: SupabaseClient,
  ttIds: string[],
  limit: number,
): Promise<{ posts: ScheduledPost[]; error: string | null }> {
  const full = await supabase
    .from("scheduled_posts")
    .select(POST_SELECT_LOGS_FULL)
    .eq("platform", "tiktok")
    .in("tiktok_account_id", ttIds)
    .order("scheduled_at", { ascending: false })
    .limit(limit);
  if (!full.error) {
    return { posts: tagTikTokPosts((full.data ?? []) as unknown as ScheduledPost[]), error: null };
  }

  const legacy = await supabase
    .from("scheduled_posts")
    .select(POST_SELECT_LOGS_TT)
    .in("tiktok_account_id", ttIds)
    .order("scheduled_at", { ascending: false })
    .limit(limit);
  if (!legacy.error) {
    return { posts: tagTikTokPosts((legacy.data ?? []) as unknown as ScheduledPost[]), error: null };
  }

  const minimal = await supabase
    .from("scheduled_posts")
    .select(POST_SELECT_LOGS_MINIMAL)
    .in("tiktok_account_id", ttIds)
    .order("scheduled_at", { ascending: false })
    .limit(limit);
  if (!minimal.error) {
    return { posts: tagTikTokPosts((minimal.data ?? []) as unknown as ScheduledPost[]), error: null };
  }

  return { posts: [], error: minimal.error.message };
}

/** Busca publish_logs em lotes para evitar URL/query muito grande no PostgREST. */
export async function fetchPublishLogsForPostIds(
  supabase: SupabaseClient,
  postIds: string[],
  limit = 300,
): Promise<{ logs: PublishLog[]; error: string | null }> {
  if (!postIds.length) return { logs: [], error: null };

  const collected: PublishLog[] = [];
  const errors: string[] = [];

  for (let offset = 0; offset < postIds.length && collected.length < limit * 2; offset += LOGS_FETCH_CHUNK) {
    const chunk = postIds.slice(offset, offset + LOGS_FETCH_CHUNK);
    const { data, error } = await supabase
      .from("publish_logs")
      .select("*")
      .in("post_id", chunk)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      errors.push(error.message);
      break;
    }

    collected.push(...((data ?? []) as PublishLog[]));
  }

  const logs = collected
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, limit);

  return { logs, error: errors.length ? errors.join("; ") : null };
}

/** Posts enxutos para a aba de Logs — select leve e limite para evitar timeout. */
export async function getOwnerPostsForLogs(
  supabase: SupabaseClient,
  ownerId: string,
  filters: OwnerPostFilters = {},
  limit = LOGS_POST_LIMIT,
): Promise<{ posts: ScheduledPost[]; error: string | null }> {
  const platform = filters.platform ?? "all";
  const accountRefs = await getOwnerAccountRefs(supabase, ownerId);

  let igIds = accountRefs.filter((a) => a.platform === "instagram").map((a) => a.id);
  let ttIds = accountRefs.filter((a) => a.platform === "tiktok").map((a) => a.id);

  if (filters.accountId) {
    const selected = accountRefs.find((a) => a.id === filters.accountId);
    if (!selected) return { posts: [], error: null };
    if (selected.platform === "instagram") {
      igIds = [selected.id];
      ttIds = [];
    } else {
      ttIds = [selected.id];
      igIds = [];
    }
  } else if (platform === "instagram") {
    ttIds = [];
  } else if (platform === "tiktok") {
    igIds = [];
  }

  const posts: ScheduledPost[] = [];
  const errors: string[] = [];

  if (igIds.length && platform !== "tiktok") {
    const result = await queryInstagramPostsForLogs(supabase, igIds, limit);
    if (result.error) errors.push(result.error);
    else posts.push(...result.posts);
  }

  if (ttIds.length && platform !== "instagram") {
    const result = await queryTikTokPostsForLogs(supabase, ttIds, limit);
    if (result.error) errors.push(result.error);
    else posts.push(...result.posts);
  }

  return {
    posts: mergePosts(posts, "desc").slice(0, limit),
    error: errors.length ? errors.join("; ") : null,
  };
}

export async function getOwnerPostById(
  supabase: SupabaseClient,
  ownerId: string,
  postId: string,
) {
  const accountRefs = await getOwnerAccountRefs(supabase, ownerId);
  const igIds = accountRefs.filter((a) => a.platform === "instagram").map((a) => a.id);
  const ttIds = accountRefs.filter((a) => a.platform === "tiktok").map((a) => a.id);

  if (!igIds.length && !ttIds.length) return null;

  const { data } = await supabase
    .from("scheduled_posts")
    .select(POST_SELECT_SECRETS)
    .eq("id", postId)
    .maybeSingle();

  const post = data as ScheduledPostWithAccountSecrets | null;
  if (!post) return null;

  if (post.platform === "tiktok") {
    if (!post.tiktok_account_id || !ttIds.includes(post.tiktok_account_id)) return null;
    return post;
  }

  if (!post.account_id || !igIds.includes(post.account_id)) return null;
  return post;
}

export function getPostAccountUsername(post: ScheduledPost) {
  if (post.platform === "tiktok") {
    return post.tiktok_accounts?.username ?? post.tiktok_accounts?.display_name ?? "conta";
  }
  return post.instagram_accounts?.ig_username ?? "conta";
}

export function canEditPost(status: PostStatus) {
  return (
    status === "pending" ||
    status === "failed" ||
    status === "retrying" ||
    status === "failed_persistent"
  );
}

export function canReschedulePost(status: PostStatus) {
  return (
    status === "pending" ||
    status === "failed" ||
    status === "retrying" ||
    status === "failed_persistent"
  );
}

export function canDeleteSchedule(status: PostStatus) {
  return (
    status === "pending" ||
    status === "failed" ||
    status === "retrying" ||
    status === "failed_persistent" ||
    status === "processing" ||
    status === "needs_media" ||
    status === "cancelled"
  );
}

export function canRetryPost(post: Pick<ScheduledPost, "status" | "media_id">) {
  if (post.media_id) return false;
  return (
    post.status === "failed" ||
    post.status === "failed_persistent" ||
    post.status === "retrying" ||
    post.status === "processing"
  );
}

export function canHideFromReport(status: PostStatus) {
  return status === "published";
}

export function canDeleteFromInstagram(status: PostStatus) {
  return status === "published";
}
