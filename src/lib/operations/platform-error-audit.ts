import type { SupabaseClient } from "@supabase/supabase-js";
import { isToday, parseISO } from "date-fns";
import { playbookHasContent } from "@/lib/ai/playbook";
import type {
  AiPlaybook,
  AccountPlaybookPayload,
  InstagramAccount,
  ScheduledPost,
  SocialPlatform,
  TikTokAccount,
} from "@/lib/types";
import { humanizeLastError } from "@/lib/operations/operational-summary";
import type { UnifiedAccountHealth } from "@/lib/operations/unified-error-audit";
import type { TokenStatus } from "@/lib/operations/account-ops";
import { deriveAccountTokenStatus } from "@/lib/operations/token-status";

const PLATFORM_ACCOUNT_LIMIT = 500;
const POST_PAGE_SIZE = 1000;
const POST_PAGE_MAX = 100;
const ACCOUNT_ID_BATCH = 80;

const POST_SELECT =
  "id, account_id, tiktok_account_id, platform, status, error_message, scheduled_at, published_at, retry_count, hidden_from_report";

export type PlatformAuditFailedPost = {
  postId: string;
  status: string;
  errorMessage: string | null;
  scheduledAt: string;
  retryCount: number | null;
};

export type PlatformAuditAggregationDebug = {
  accountId: string;
  account: string;
  platform: SocialPlatform;
  scheduledPostsMatched: number;
  failedPostsMatched: number;
  retryingPostsMatched: number;
  joinKeysUsed: string[];
};

export type PlatformAuditConsistencyCheck = {
  account: string;
  accountId: string;
  fullModeFailedPosts: number;
  searchModeFailedPosts: number;
  fullModeRetryingPosts: number;
  searchModeRetryingPosts: number;
  match: boolean;
};

export type PlatformAuditMatchedAccount = {
  ownerId: string;
  ownerEmailMasked: string;
  effectiveOwnerId: string;
  platform: SocialPlatform;
  account: string;
  accountId: string;
  pending: number;
  failed: number;
  retrying: number;
  publishedToday: number;
  lastError: string | null;
  tokenStatus: TokenStatus;
  playbookConfigured: boolean;
  publishingPaused: boolean;
  health: UnifiedAccountHealth;
  currentOwnerCanSee: boolean;
  openOperationalErrors: number;
  failedPosts?: PlatformAuditFailedPost[];
  aggregationDebug?: PlatformAuditAggregationDebug;
};

export type OwnerDivergenceIssue = {
  issue: "account_belongs_to_different_owner";
  account: string;
  accountId: string;
  platform: SocialPlatform;
  sessionOwnerId: string;
  foundInOwnerId: string;
  currentOwnerCanSee: boolean;
  recommendation: string;
};

export type PlatformAuditOwnerSummary = {
  ownerId: string;
  ownerEmailMasked: string;
  instagramAccounts: number;
  tiktokAccounts: number;
  failedPosts: number;
  retryingPosts: number;
  openOperationalErrors: number;
  openAuditFindings: number;
};

export type PlatformErrorAuditParams = {
  scope?: "platform";
  accountSearch?: string;
  includeAccounts?: boolean;
  includePosts?: boolean;
  includeOperationalErrors?: boolean;
  includeOwners?: boolean;
  sessionOwnerId: string;
};

export type PlatformErrorAuditResult = {
  ok: true;
  generatedAt: string;
  scope: "platform";
  sessionOwnerId: string;
  accountSearch: string | null;
  matchedAccounts: PlatformAuditMatchedAccount[];
  allAccountsCount: number;
  ownerDivergence: OwnerDivergenceIssue[];
  consistencyChecks: PlatformAuditConsistencyCheck[];
  summary: {
    totalOwnersScanned: number;
    totalAccounts: number;
    matchedAccounts: number;
    failedPosts: number;
    retryingPosts: number;
    openOperationalErrors: number;
    openAuditFindings: number;
  };
  errorsByAccount: Array<{
    ownerId: string;
    accountId: string;
    account: string;
    platform: SocialPlatform;
    failedPosts: number;
    retryingPosts: number;
    lastError: string | null;
    openOperationalErrors: number;
    operationalErrors: Array<{
      title: string;
      message: string;
      severity: string;
      category: string;
    }>;
    failedPostsList?: PlatformAuditFailedPost[];
  }>;
  owners?: PlatformAuditOwnerSummary[];
};

function chunk<T>(items: T[], size: number) {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }
  return batches;
}

function normalizeSearchTerm(value: string | undefined) {
  return (value ?? "").replace(/^@/, "").trim().toLowerCase();
}

export function maskOwnerIdentifier(ownerId: string): string {
  if (!ownerId) return "—";
  if (ownerId.includes("@")) {
    const [local, domain] = ownerId.split("@");
    const maskedLocal = local.length <= 1 ? "*" : `${local[0]}***`;
    return `${maskedLocal}@${domain}`;
  }
  if (ownerId.length <= 8) return `${ownerId.slice(0, 2)}***`;
  return `${ownerId.slice(0, 4)}…${ownerId.slice(-4)}`;
}

function effectiveInstagramOwner(account: InstagramAccount) {
  return (account.owner_id ?? account.user_id).trim();
}

function effectiveTikTokOwner(account: TikTokAccount) {
  return account.owner_id.trim();
}

function accountHandle(username: string | null, fallbackId: string) {
  if (!username) return `@${fallbackId.slice(0, 8)}`;
  return username.startsWith("@") ? username : `@${username}`;
}

function sessionCanSeeInstagramAccount(account: InstagramAccount, sessionOwnerId: string) {
  return (
    account.owner_id === sessionOwnerId ||
    account.user_id === sessionOwnerId ||
    effectiveInstagramOwner(account) === sessionOwnerId
  );
}

function sessionCanSeeTikTokAccount(account: TikTokAccount, sessionOwnerId: string) {
  return account.owner_id === sessionOwnerId || effectiveTikTokOwner(account) === sessionOwnerId;
}

function isFailedStatus(status: string) {
  return status === "failed" || status === "failed_persistent";
}

function isPlaybookConfiguredForAccount(
  ownerId: string,
  accountId: string,
  row: AiPlaybook | null,
): boolean {
  if (!row || row.owner_id !== ownerId) return false;
  const map = row.playbooks_by_account ?? {};
  const perAccount = map[accountId] as AccountPlaybookPayload | undefined;
  if (perAccount && playbookHasContent(perAccount)) return true;
  if (Object.keys(map).length > 0) return false;
  return playbookHasContent(row);
}

function deriveHealth(params: {
  tokenStatus: TokenStatus;
  failed: number;
  retrying: number;
  publishingPaused: boolean;
  playbookConfigured: boolean;
  lastError: string | null;
}): UnifiedAccountHealth {
  if (params.tokenStatus === "expired" || params.publishingPaused) {
    return "paused_or_blocked";
  }
  if (params.failed > 0 && /unaudited_client|url_ownership/i.test(params.lastError ?? "")) {
    return "error";
  }
  if (params.failed >= 5) return "error";
  if (params.failed > 0 || params.retrying > 0 || !params.playbookConfigured) {
    return "attention";
  }
  return "healthy";
}

function computePostStats(posts: ScheduledPost[]) {
  const failedPosts = posts.filter((p) => isFailedStatus(p.status));
  const retryingPosts = posts.filter((p) => p.status === "retrying");
  const lastErrorPost = [...failedPosts, ...retryingPosts]
    .filter((p) => p.error_message)
    .sort((a, b) => new Date(b.scheduled_at).getTime() - new Date(a.scheduled_at).getTime())[0];

  return {
    pending: posts.filter((p) => p.status === "pending").length,
    failed: failedPosts.length,
    retrying: retryingPosts.length,
    publishedToday: posts.filter(
      (p) => p.status === "published" && p.published_at && isToday(parseISO(p.published_at)),
    ).length,
    lastError: humanizeLastError(lastErrorPost?.error_message ?? null),
    failedPostsList: [...failedPosts, ...retryingPosts]
      .sort((a, b) => new Date(b.scheduled_at).getTime() - new Date(a.scheduled_at).getTime())
      .map((p) => ({
        postId: p.id,
        status: p.status,
        errorMessage: p.error_message,
        scheduledAt: p.scheduled_at,
        retryCount: p.retry_count ?? null,
      })),
  };
}

function matchesAccountSearch(
  username: string | null,
  displayName: string | null,
  search: string,
) {
  if (!search) return true;
  const haystack = [username, displayName]
    .filter(Boolean)
    .map((v) => v!.replace(/^@/, "").toLowerCase());
  return haystack.some((v) => v.includes(search) || search.includes(v));
}

function accountMatchesSearch(
  account: PlatformAuditMatchedAccount,
  search: string,
  igUsername: string | null,
  ttUsername: string | null,
  ttDisplayName: string | null,
) {
  if (!search) return true;
  if (account.account.replace(/^@/, "").toLowerCase().includes(search)) return true;
  if (account.platform === "instagram") {
    return matchesAccountSearch(igUsername, null, search);
  }
  return matchesAccountSearch(ttUsername, ttDisplayName, search);
}

async function loadAllInstagramAccounts(supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from("instagram_accounts")
    .select(
      "id, owner_id, user_id, ig_username, page_access_token, publishing_paused, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(PLATFORM_ACCOUNT_LIMIT);

  if (error) throw new Error(error.message);
  return (data as InstagramAccount[]) ?? [];
}

async function loadAllTikTokAccounts(supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from("tiktok_accounts")
    .select(
      "id, owner_id, username, display_name, access_token, token_expires_at, status, last_validation_error, publishing_paused, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(PLATFORM_ACCOUNT_LIMIT);

  if (error) throw new Error(error.message);
  return (data as TikTokAccount[]) ?? [];
}

async function fetchPostPage(
  supabase: SupabaseClient,
  filter: {
    column: "account_id" | "tiktok_account_id";
    ids: string[];
  },
  page: number,
) {
  const from = page * POST_PAGE_SIZE;
  const to = from + POST_PAGE_SIZE - 1;

  const { data, error } = await supabase
    .from("scheduled_posts")
    .select(POST_SELECT)
    .in(filter.column, filter.ids)
    .eq("hidden_from_report", false)
    .order("scheduled_at", { ascending: false })
    .range(from, to);

  if (error) throw new Error(error.message);
  return (data as ScheduledPost[]) ?? [];
}

async function loadAllPostsForAccountIds(
  supabase: SupabaseClient,
  column: "account_id" | "tiktok_account_id",
  accountIds: string[],
) {
  if (!accountIds.length) return [] as ScheduledPost[];

  const posts: ScheduledPost[] = [];
  for (const idBatch of chunk(accountIds, ACCOUNT_ID_BATCH)) {
    for (let page = 0; page < POST_PAGE_MAX; page++) {
      const pagePosts = await fetchPostPage(supabase, { column, ids: idBatch }, page);
      posts.push(...pagePosts);
      if (pagePosts.length < POST_PAGE_SIZE) break;
    }
  }
  return posts;
}

function indexInstagramPosts(posts: ScheduledPost[]) {
  const postsByIg = new Map<string, ScheduledPost[]>();
  for (const post of posts) {
    const platform = post.platform ?? "instagram";
    if (platform === "tiktok") continue;
    if (!post.account_id) continue;
    const bucket = postsByIg.get(post.account_id) ?? [];
    bucket.push(post);
    postsByIg.set(post.account_id, bucket);
  }
  return postsByIg;
}

function indexTikTokPosts(posts: ScheduledPost[]) {
  const postsByTt = new Map<string, ScheduledPost[]>();
  for (const post of posts) {
    if (!post.tiktok_account_id) continue;
    const bucket = postsByTt.get(post.tiktok_account_id) ?? [];
    bucket.push(post);
    postsByTt.set(post.tiktok_account_id, bucket);
  }
  return postsByTt;
}

type OperationalRow = {
  id: string;
  owner_id: string;
  account_id: string | null;
  platform: string | null;
  title: string;
  message: string;
  severity: string;
  category: string;
  status: string;
};

function buildEnrichedAccount(params: {
  platform: SocialPlatform;
  accountId: string;
  handle: string;
  effectiveOwnerId: string;
  accountPosts: ScheduledPost[];
  joinKeysUsed: string[];
  igAccount?: InstagramAccount;
  tiktokAccount?: TikTokAccount;
  playbookByOwner: Map<string, AiPlaybook>;
  operationalByAccount: Map<string, OperationalRow[]>;
  sessionOwnerId: string;
  includePosts: boolean;
  includeDebug: boolean;
}): PlatformAuditMatchedAccount {
  const stats = computePostStats(params.accountPosts);
  const tokenStatus =
    params.platform === "tiktok" && params.tiktokAccount
      ? deriveAccountTokenStatus({ platform: "tiktok", tiktokAccount: params.tiktokAccount })
      : deriveAccountTokenStatus({ platform: "instagram", igAccount: params.igAccount });

  const playbookConfigured = isPlaybookConfiguredForAccount(
    params.effectiveOwnerId,
    params.accountId,
    params.playbookByOwner.get(params.effectiveOwnerId) ?? null,
  );

  const publishingPaused = Boolean(
    params.igAccount?.publishing_paused ?? params.tiktokAccount?.publishing_paused,
  );

  const currentOwnerCanSee =
    params.platform === "tiktok" && params.tiktokAccount
      ? sessionCanSeeTikTokAccount(params.tiktokAccount, params.sessionOwnerId)
      : params.igAccount
        ? sessionCanSeeInstagramAccount(params.igAccount, params.sessionOwnerId)
        : false;

  const openOperationalErrors = params.operationalByAccount.get(params.accountId)?.length ?? 0;

  return {
    ownerId: params.effectiveOwnerId,
    ownerEmailMasked: maskOwnerIdentifier(params.effectiveOwnerId),
    effectiveOwnerId: params.effectiveOwnerId,
    platform: params.platform,
    account: params.handle,
    accountId: params.accountId,
    pending: stats.pending,
    failed: stats.failed,
    retrying: stats.retrying,
    publishedToday: stats.publishedToday,
    lastError: stats.lastError,
    tokenStatus,
    playbookConfigured,
    publishingPaused,
    health: deriveHealth({
      tokenStatus,
      failed: stats.failed,
      retrying: stats.retrying,
      publishingPaused,
      playbookConfigured,
      lastError: stats.lastError,
    }),
    currentOwnerCanSee,
    openOperationalErrors,
    ...(params.includePosts ? { failedPosts: stats.failedPostsList } : {}),
    ...(params.includeDebug
      ? {
          aggregationDebug: {
            accountId: params.accountId,
            account: params.handle,
            platform: params.platform,
            scheduledPostsMatched: params.accountPosts.length,
            failedPostsMatched: stats.failed,
            retryingPostsMatched: stats.retrying,
            joinKeysUsed: params.joinKeysUsed,
          },
        }
      : {}),
  };
}

export async function buildPlatformErrorAudit(
  supabase: SupabaseClient,
  params: PlatformErrorAuditParams,
): Promise<PlatformErrorAuditResult> {
  const search = normalizeSearchTerm(params.accountSearch);
  const includePosts = params.includePosts ?? true;
  const includeOperationalErrors = params.includeOperationalErrors ?? true;
  const includeOwners = params.includeOwners ?? true;

  // 1. Always load all platform accounts (search does not change base queries)
  const [allIgAccounts, allTtAccounts] = await Promise.all([
    loadAllInstagramAccounts(supabase),
    loadAllTikTokAccounts(supabase),
  ]);

  const allOwnerIds = new Set<string>();
  for (const account of allIgAccounts) allOwnerIds.add(effectiveInstagramOwner(account));
  for (const account of allTtAccounts) allOwnerIds.add(effectiveTikTokOwner(account));
  const ownerIdList = [...allOwnerIds];

  // 2. Load posts for all account IDs with pagination (same path for full and filtered modes)
  const [igPosts, ttPosts, playbookRows, operationalRows, auditRows] = await Promise.all([
    includePosts || params.includeAccounts !== false
      ? loadAllPostsForAccountIds(
          supabase,
          "account_id",
          allIgAccounts.map((a) => a.id),
        )
      : Promise.resolve([] as ScheduledPost[]),
    includePosts || params.includeAccounts !== false
      ? loadAllPostsForAccountIds(
          supabase,
          "tiktok_account_id",
          allTtAccounts.map((a) => a.id),
        )
      : Promise.resolve([] as ScheduledPost[]),
    ownerIdList.length
      ? supabase.from("ai_playbooks").select("*").in("owner_id", ownerIdList)
      : Promise.resolve({ data: [] as AiPlaybook[], error: null }),
    includeOperationalErrors && ownerIdList.length
      ? supabase
          .from("operational_errors")
          .select(
            "id, owner_id, account_id, platform, title, message, severity, category, status",
          )
          .in("owner_id", ownerIdList)
          .not("status", "in", '("resolved","ignored")')
          .limit(5000)
      : Promise.resolve({ data: [], error: null }),
    ownerIdList.length
      ? supabase
          .from("audit_findings")
          .select("owner_id, status")
          .in("owner_id", ownerIdList)
          .in("status", ["open", "reopened", "validating"])
          .limit(5000)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (playbookRows.error) throw new Error(playbookRows.error.message);
  if (operationalRows.error) throw new Error(operationalRows.error.message);
  if (auditRows.error && !auditRows.error.message.includes("audit_findings")) {
    throw new Error(auditRows.error.message);
  }

  const playbookByOwner = new Map<string, AiPlaybook>();
  for (const row of (playbookRows.data as AiPlaybook[]) ?? []) {
    playbookByOwner.set(row.owner_id, row);
  }

  const operationalByAccount = new Map<string, OperationalRow[]>();
  for (const row of (operationalRows.data ?? []) as OperationalRow[]) {
    if (!row.account_id) continue;
    const bucket = operationalByAccount.get(row.account_id) ?? [];
    bucket.push(row);
    operationalByAccount.set(row.account_id, bucket);
  }

  const postsByIg = indexInstagramPosts(igPosts);
  const postsByTt = indexTikTokPosts(ttPosts);

  // 3. Enrich ALL accounts with the same aggregators
  const allEnrichedAccounts: PlatformAuditMatchedAccount[] = [];

  for (const account of allIgAccounts) {
    const effectiveOwnerId = effectiveInstagramOwner(account);
    const handle = accountHandle(account.ig_username, account.id);
    allEnrichedAccounts.push(
      buildEnrichedAccount({
        platform: "instagram",
        accountId: account.id,
        handle,
        effectiveOwnerId,
        accountPosts: postsByIg.get(account.id) ?? [],
        joinKeysUsed: ["account_id", "platform=instagram", "owner_id"],
        igAccount: account,
        playbookByOwner,
        operationalByAccount,
        sessionOwnerId: params.sessionOwnerId,
        includePosts,
        includeDebug: true,
      }),
    );
  }

  for (const account of allTtAccounts) {
    const effectiveOwnerId = effectiveTikTokOwner(account);
    const handle = accountHandle(account.username ?? account.display_name, account.id);
    allEnrichedAccounts.push(
      buildEnrichedAccount({
        platform: "tiktok",
        accountId: account.id,
        handle,
        effectiveOwnerId,
        accountPosts: postsByTt.get(account.id) ?? [],
        joinKeysUsed: ["tiktok_account_id", "platform=tiktok", "owner_id"],
        tiktokAccount: account,
        playbookByOwner,
        operationalByAccount,
        sessionOwnerId: params.sessionOwnerId,
        includePosts,
        includeDebug: true,
      }),
    );
  }

  // 4. Apply accountSearch only after aggregation
  const igById = new Map(allIgAccounts.map((a) => [a.id, a]));
  const ttById = new Map(allTtAccounts.map((a) => [a.id, a]));

  const matchedAccounts = search
    ? allEnrichedAccounts.filter((account) => {
        const ig = account.platform === "instagram" ? igById.get(account.accountId) : null;
        const tt = account.platform === "tiktok" ? ttById.get(account.accountId) : null;
        return accountMatchesSearch(
          account,
          search,
          ig?.ig_username ?? null,
          tt?.username ?? null,
          tt?.display_name ?? null,
        );
      })
    : allEnrichedAccounts;

  const ownerDivergence: OwnerDivergenceIssue[] = [];
  if (search) {
    for (const account of matchedAccounts) {
      if (account.currentOwnerCanSee) continue;
      ownerDivergence.push({
        issue: "account_belongs_to_different_owner",
        account: account.account,
        accountId: account.accountId,
        platform: account.platform,
        sessionOwnerId: params.sessionOwnerId,
        foundInOwnerId: account.effectiveOwnerId,
        currentOwnerCanSee: false,
        recommendation:
          "Use platform audit/admin view or migrate/link account to the correct owner/workspace.",
      });
    }
  }

  const consistencyChecks: PlatformAuditConsistencyCheck[] = matchedAccounts.map((filtered) => {
    const canonical = allEnrichedAccounts.find(
      (a) => a.accountId === filtered.accountId && a.platform === filtered.platform,
    )!;
    return {
      account: canonical.account,
      accountId: canonical.accountId,
      fullModeFailedPosts: canonical.failed,
      searchModeFailedPosts: filtered.failed,
      fullModeRetryingPosts: canonical.retrying,
      searchModeRetryingPosts: filtered.retrying,
      match:
        canonical.failed === filtered.failed &&
        canonical.retrying === filtered.retrying &&
        canonical.pending === filtered.pending,
    };
  });

  const summarySource = matchedAccounts;

  const errorsByAccount = matchedAccounts.map((account) => ({
    ownerId: account.effectiveOwnerId,
    accountId: account.accountId,
    account: account.account,
    platform: account.platform,
    failedPosts: account.failed,
    retryingPosts: account.retrying,
    lastError: account.lastError,
    openOperationalErrors: account.openOperationalErrors,
    operationalErrors: (operationalByAccount.get(account.accountId) ?? []).map((row) => ({
      title: String(row.title),
      message: String(row.message),
      severity: String(row.severity),
      category: String(row.category),
    })),
    ...(includePosts && account.failedPosts ? { failedPostsList: account.failedPosts } : {}),
  }));

  const openAuditFindings = (auditRows.data ?? []).length;
  const openOperationalErrors = (operationalRows.data ?? []).length;

  const owners: PlatformAuditOwnerSummary[] | undefined = includeOwners
    ? ownerIdList.map((ownerId) => {
        const ownerAccounts = allEnrichedAccounts.filter((a) => a.effectiveOwnerId === ownerId);
        return {
          ownerId,
          ownerEmailMasked: maskOwnerIdentifier(ownerId),
          instagramAccounts: ownerAccounts.filter((a) => a.platform === "instagram").length,
          tiktokAccounts: ownerAccounts.filter((a) => a.platform === "tiktok").length,
          failedPosts: ownerAccounts.reduce((sum, a) => sum + a.failed, 0),
          retryingPosts: ownerAccounts.reduce((sum, a) => sum + a.retrying, 0),
          openOperationalErrors: (operationalRows.data ?? []).filter((r) => r.owner_id === ownerId)
            .length,
          openAuditFindings: (auditRows.data ?? []).filter((r) => r.owner_id === ownerId).length,
        };
      })
    : undefined;

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    scope: "platform",
    sessionOwnerId: params.sessionOwnerId,
    accountSearch: search || null,
    matchedAccounts,
    allAccountsCount: allEnrichedAccounts.length,
    ownerDivergence,
    consistencyChecks,
    summary: {
      totalOwnersScanned: ownerIdList.length,
      totalAccounts: allEnrichedAccounts.length,
      matchedAccounts: matchedAccounts.length,
      failedPosts: summarySource.reduce((sum, a) => sum + a.failed, 0),
      retryingPosts: summarySource.reduce((sum, a) => sum + a.retrying, 0),
      openOperationalErrors,
      openAuditFindings,
    },
    errorsByAccount,
    ...(owners ? { owners } : {}),
  };
}
