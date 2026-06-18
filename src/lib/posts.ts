import type { SupabaseClient } from "@supabase/supabase-js";
import { getOwnerAccounts } from "@/lib/accounts";
import { getOwnerTikTokAccounts } from "@/lib/tiktok/accounts";
import type {
  PostStatus,
  ScheduledPost,
  ScheduledPostWithAccountSecrets,
  SocialPlatform,
  ContentType,
} from "@/lib/types";

const POST_SELECT_PUBLIC =
  "*, instagram_accounts(ig_username, profile_picture_url), tiktok_accounts(username, display_name, profile_picture_url), products(id, name, main_cta), campaigns(id, name, default_cta, objective)";

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

  let query = supabase
    .from("scheduled_posts")
    .select(POST_SELECT_PUBLIC)
    .eq("platform", "instagram")
    .in("account_id", igIds);

  if (filters.status) query = query.eq("status", filters.status);
  if (filters.hiddenFromReport === false) query = query.eq("hidden_from_report", false);

  const { data } = await query;
  return (data as ScheduledPost[]) ?? [];
}

async function queryTikTokPosts(
  supabase: SupabaseClient,
  ttIds: string[],
  filters: OwnerPostFilters,
) {
  if (!ttIds.length) return [] as ScheduledPost[];

  let query = supabase
    .from("scheduled_posts")
    .select(POST_SELECT_PUBLIC)
    .eq("platform", "tiktok")
    .in("tiktok_account_id", ttIds);

  if (filters.status) query = query.eq("status", filters.status);
  if (filters.hiddenFromReport === false) query = query.eq("hidden_from_report", false);

  const { data } = await query;
  return (data as ScheduledPost[]) ?? [];
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

  const [igPosts, ttPosts] = await Promise.all([
    platform === "tiktok" ? [] : queryInstagramPosts(supabase, igIds, filters),
    platform === "instagram" ? [] : queryTikTokPosts(supabase, ttIds, filters),
  ]);

  const merged = mergePosts([...igPosts, ...ttPosts], order);

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
    status === "processing"
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
