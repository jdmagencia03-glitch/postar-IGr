import { isToday, parseISO } from "date-fns";
import { getPlaybookForAccount, playbookHasContent, resolveNicheFromPlaybook } from "@/lib/ai/playbook";
import { CONTENT_TYPE_LABELS } from "@/lib/content-types";
import { computeAccountWindowMetrics } from "@/lib/operations/metrics";
import type { OwnerAccountRef } from "@/lib/posts";
import type { ContentType, InstagramAccount, ScheduledPost, SocialPlatform, TikTokAccount } from "@/lib/types";

export type AccountHealthLevel = "healthy" | "attention" | "error";
export type TokenStatus = "valid" | "expired" | "unknown";

export interface AccountOperationsSummary {
  id: string;
  platform: SocialPlatform;
  username: string | null;
  displayName: string | null;
  profilePicture: string | null;
  niche: string | null;
  playbookConfigured: boolean;
  health: AccountHealthLevel;
  tokenStatus: TokenStatus;
  publishingPaused: boolean;
  publishedToday: number;
  publishedLast7Days: number;
  publishedLast30Days: number;
  pendingCount: number;
  storiesPending: number;
  storiesFailed: number;
  storiesBlocked: number;
  tiktokPending: number;
  tiktokFailed: number;
  failedCount: number;
  failedPersistentCount: number;
  retryingCount: number;
  successRate: number;
  topContentType: string | null;
  nextPublication: string | null;
  lastPublication: string | null;
  lastError: string | null;
}

function accountPosts(posts: ScheduledPost[], accountId: string, platform: SocialPlatform) {
  return posts.filter((post) => {
    if (platform === "tiktok") return post.tiktok_account_id === accountId;
    return post.account_id === accountId;
  });
}

function deriveHealth(params: {
  tokenStatus: TokenStatus;
  failedCount: number;
  storiesBlocked: number;
  publishingPaused: boolean;
}): AccountHealthLevel {
  if (params.tokenStatus === "expired" || params.failedCount >= 3) return "error";
  if (params.failedCount > 0 || params.storiesBlocked > 0 || params.publishingPaused) return "attention";
  return "healthy";
}

function tiktokTokenStatus(account: TikTokAccount): TokenStatus {
  if (!account.token_expires_at) return "unknown";
  return new Date(account.token_expires_at).getTime() > Date.now() ? "valid" : "expired";
}

export async function buildAccountOperationsSummary(params: {
  ref: OwnerAccountRef;
  igAccount?: InstagramAccount | null;
  tiktokAccount?: TikTokAccount | null;
  posts: ScheduledPost[];
  ownerId: string;
  tokenStatus?: TokenStatus;
}): Promise<AccountOperationsSummary> {
  const { ref, posts, ownerId } = params;
  const scoped = accountPosts(posts, ref.id, ref.platform);

  const playbook = await getPlaybookForAccount(ownerId, ref.id);
  const niche = resolveNicheFromPlaybook(playbook, undefined);

  const publishedToday = scoped.filter(
    (post) => post.status === "published" && post.published_at && isToday(parseISO(post.published_at)),
  ).length;

  const pendingCount = scoped.filter((post) => post.status === "pending" || post.status === "retrying").length;
  const storiesPending = scoped.filter(
    (post) => post.content_type === "story" && (post.status === "pending" || post.status === "retrying"),
  ).length;
  const storiesFailed = scoped.filter(
    (post) =>
      post.content_type === "story" &&
      (post.status === "failed" || post.status === "failed_persistent"),
  ).length;
  const storiesBlocked = scoped.filter(
    (post) => post.content_type === "story" && post.publish_block_reason && post.status === "pending",
  ).length;

  const tiktokPending =
    ref.platform === "tiktok"
      ? scoped.filter((post) => post.status === "pending" || post.status === "retrying").length
      : 0;
  const tiktokFailed =
    ref.platform === "tiktok"
      ? scoped.filter((post) => post.status === "failed" || post.status === "failed_persistent").length
      : 0;

  const failedCount = scoped.filter(
    (post) => post.status === "failed" || post.status === "failed_persistent",
  ).length;
  const failedPersistentCount = scoped.filter((post) => post.status === "failed_persistent").length;
  const retryingCount = scoped.filter((post) => post.status === "retrying").length;

  const windowMetrics = computeAccountWindowMetrics(posts, ref.id, ref.platform);

  const nextPublication =
    scoped
      .filter((post) => post.status === "pending" || post.status === "retrying")
      .sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime())[0]
      ?.scheduled_at ?? null;

  const lastPublication =
    scoped
      .filter((post) => post.status === "published" && post.published_at)
      .sort((a, b) => new Date(b.published_at!).getTime() - new Date(a.published_at!).getTime())[0]
      ?.published_at ?? null;

  const lastError =
    scoped
      .filter((post) => post.error_message)
      .sort((a, b) => new Date(b.scheduled_at).getTime() - new Date(a.scheduled_at).getTime())[0]
      ?.error_message ?? null;

  const tokenStatus =
    params.tokenStatus ??
    (ref.platform === "tiktok" && params.tiktokAccount
      ? tiktokTokenStatus(params.tiktokAccount)
      : "unknown");

  const publishingPaused = Boolean(
    params.igAccount?.publishing_paused ?? params.tiktokAccount?.publishing_paused,
  );

  const health = deriveHealth({ tokenStatus, failedCount, storiesBlocked, publishingPaused });

  return {
    id: ref.id,
    platform: ref.platform,
    username: ref.username,
    displayName:
      ref.platform === "tiktok"
        ? params.tiktokAccount?.display_name ?? ref.username
        : ref.username,
    profilePicture: ref.profile_picture_url,
    niche: niche || null,
    playbookConfigured: playbookHasContent(playbook),
    health,
    tokenStatus,
    publishingPaused,
    publishedToday,
    publishedLast7Days: windowMetrics.publishedLast7Days,
    publishedLast30Days: windowMetrics.publishedLast30Days,
    pendingCount,
    storiesPending,
    storiesFailed,
    storiesBlocked,
    tiktokPending,
    tiktokFailed,
    failedCount,
    failedPersistentCount,
    retryingCount,
    successRate: windowMetrics.successRate,
    topContentType: windowMetrics.topContentType
      ? CONTENT_TYPE_LABELS[windowMetrics.topContentType as ContentType]
      : null,
    nextPublication,
    lastPublication,
    lastError,
  };
}

export async function buildAllAccountOperationsSummaries(params: {
  refs: OwnerAccountRef[];
  igAccounts: InstagramAccount[];
  tiktokAccounts: TikTokAccount[];
  posts: ScheduledPost[];
  ownerId: string;
  tokenStatusByAccountId?: Record<string, TokenStatus>;
}) {
  const igMap = new Map(params.igAccounts.map((account) => [account.id, account]));
  const ttMap = new Map(params.tiktokAccounts.map((account) => [account.id, account]));

  return Promise.all(
    params.refs.map((ref) =>
      buildAccountOperationsSummary({
        ref,
        igAccount: ref.platform === "instagram" ? igMap.get(ref.id) : null,
        tiktokAccount: ref.platform === "tiktok" ? ttMap.get(ref.id) : null,
        posts: params.posts,
        ownerId: params.ownerId,
        tokenStatus: params.tokenStatusByAccountId?.[ref.id],
      }),
    ),
  );
}

export function healthLabel(health: AccountHealthLevel) {
  if (health === "healthy") return "Saudável";
  if (health === "attention") return "Atenção";
  return "Erro";
}

export function healthClass(health: AccountHealthLevel) {
  if (health === "healthy") return "text-emerald-600 bg-emerald-500/10";
  if (health === "attention") return "text-amber-600 bg-amber-500/10";
  return "text-ig-danger bg-ig-danger/10";
}
