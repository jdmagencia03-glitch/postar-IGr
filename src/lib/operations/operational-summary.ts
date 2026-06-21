import { isToday, parseISO } from "date-fns";
import { getPlaybookForAccount, playbookHasContent, resolveNicheFromPlaybook } from "@/lib/ai/playbook";
import { CONTENT_TYPE_LABELS } from "@/lib/content-types";
import { computeAccountWindowMetrics } from "@/lib/operations/metrics";
import { deriveAccountTokenStatus } from "@/lib/operations/token-status";
import type { OwnerAccountRef } from "@/lib/posts";
import {
  ACTIVE_SLOT_STATUSES,
  detectDuplicateSlots,
  slotTimeKey,
} from "@/lib/schedule-slots";
import type { ContentType, InstagramAccount, ScheduledPost, SocialPlatform, TikTokAccount } from "@/lib/types";
import type { AccountHealthLevel, AccountOperationsSummary, TokenStatus } from "@/lib/operations/account-ops";

export type OperationalAlert = {
  id: string;
  severity: "info" | "warning" | "error";
  title: string;
  message: string;
  actionHref?: string;
  actionLabel?: string;
};

export interface AccountOperationalSummary extends AccountOperationsSummary {
  healthPercent: number;
  statusMessage: string;
  recommendedAction: string | null;
  alerts: OperationalAlert[];
  duplicateSlotCount: number;
  duplicateSlots: ReturnType<typeof detectDuplicateSlots>;
  processingCount: number;
  incompletePosts: number;
  postsWithoutCaption: number;
  postsWithoutHashtags: number;
  globalPendingCount?: number;
}

const TIKTOK_URL_OWNERSHIP_MESSAGE =
  "TikTok não validou a URL do vídeo. Verifique a propriedade do domínio/URL ou altere o método de upload.";

export function isCriticalTikTokError(message: string | null | undefined) {
  if (!message) return false;
  return /url_ownership_unverified/i.test(message);
}

export function humanizeLastError(message: string | null | undefined) {
  if (!message) return null;
  if (isCriticalTikTokError(message)) return TIKTOK_URL_OWNERSHIP_MESSAGE;
  return message;
}

export function filterPostsForAccount(
  posts: ScheduledPost[],
  accountId: string,
  platform: SocialPlatform,
) {
  return posts.filter((post) => {
    if (platform === "tiktok") {
      return post.platform === "tiktok" && post.tiktok_account_id === accountId;
    }
    return (post.platform ?? "instagram") !== "tiktok" && post.account_id === accountId;
  });
}

function extractHashtags(caption: string | null) {
  if (!caption) return [];
  return caption.match(/#[\w\u00C0-\u017F]+/g) ?? [];
}

export function deriveOperationalHealth(params: {
  tokenStatus: TokenStatus;
  failedCount: number;
  failedPersistentCount: number;
  retryingCount: number;
  processingCount: number;
  storiesBlocked: number;
  publishingPaused: boolean;
  lastError: string | null;
  duplicateSlotCount: number;
  playbookConfigured: boolean;
  tiktokAccountStatus?: TikTokAccount["status"];
}): AccountHealthLevel {
  if (
    params.tokenStatus === "expired" ||
    params.failedPersistentCount > 0 ||
    isCriticalTikTokError(params.lastError) ||
    params.tiktokAccountStatus === "error" ||
    params.tiktokAccountStatus === "disconnected"
  ) {
    return "error";
  }

  if (
    params.failedCount > 0 ||
    params.retryingCount > 0 ||
    params.processingCount > 0 ||
    params.storiesBlocked > 0 ||
    params.publishingPaused ||
    params.duplicateSlotCount > 0 ||
    !params.playbookConfigured
  ) {
    return "attention";
  }

  return "healthy";
}

export function computeOperationalHealthPercent(params: {
  health: AccountHealthLevel;
  tokenStatus: TokenStatus;
  failedCount: number;
  failedPersistentCount: number;
  retryingCount: number;
  duplicateSlotCount: number;
  playbookConfigured: boolean;
  pendingCount: number;
}) {
  if (params.health === "error") {
    return Math.max(0, 35 - params.failedPersistentCount * 5);
  }
  if (params.health === "attention") {
    let score = 70;
    if (params.retryingCount > 0) score -= 10;
    if (params.failedCount > 0) score -= 10;
    if (params.duplicateSlotCount > 0) score -= 15;
    if (!params.playbookConfigured) score -= 10;
    if (params.tokenStatus !== "valid") score -= 10;
    return Math.max(25, score);
  }
  if (params.pendingCount <= 0) return 85;
  return 100;
}

function buildOperationalAlerts(params: {
  health: AccountHealthLevel;
  lastError: string | null;
  duplicateSlotCount: number;
  retryingCount: number;
  failedPersistentCount: number;
  playbookConfigured: boolean;
  accountId: string;
  platform: SocialPlatform;
}): OperationalAlert[] {
  const alerts: OperationalAlert[] = [];

  if (isCriticalTikTokError(params.lastError)) {
    alerts.push({
      id: "tiktok-url-ownership",
      severity: "error",
      title: "URL não validada pelo TikTok",
      message: TIKTOK_URL_OWNERSHIP_MESSAGE,
      actionHref: `/dashboard/accounts/${params.accountId}/diagnostics?platform=${params.platform}`,
      actionLabel: "Ver diagnóstico",
    });
  }

  if (params.duplicateSlotCount > 0) {
    alerts.push({
      id: "duplicate-slots",
      severity: "warning",
      title: "Horários duplicados detectados",
      message: `${params.duplicateSlotCount} horário(s) com mais de um post ativo.`,
      actionHref: "/dashboard/reports?view=audit",
      actionLabel: "Corrigir automaticamente",
    });
  }

  if (params.retryingCount > 0) {
    alerts.push({
      id: "retrying",
      severity: "warning",
      title: "Posts em retry",
      message: `${params.retryingCount} publicação(ões) aguardando nova tentativa.`,
      actionHref: "/dashboard/reports?status=retrying",
      actionLabel: "Ver fila",
    });
  }

  if (params.failedPersistentCount > 0) {
    alerts.push({
      id: "failed-persistent",
      severity: "error",
      title: "Falha persistente",
      message: `${params.failedPersistentCount} post(s) exigem ação manual.`,
      actionHref: "/dashboard/reports?status=failed_persistent",
      actionLabel: "Ver falhas",
    });
  }

  if (!params.playbookConfigured) {
    alerts.push({
      id: "no-playbook",
      severity: "info",
      title: "Conta sem playbook",
      message: "Configure o Assistente de Conteúdo para legendas no nicho correto.",
      actionHref: `/dashboard/ai?account=${params.accountId}`,
      actionLabel: "Configurar IA",
    });
  }

  return alerts;
}

export async function buildAccountOperationalSummary(params: {
  ref: OwnerAccountRef;
  igAccount?: InstagramAccount | null;
  tiktokAccount?: TikTokAccount | null;
  posts: ScheduledPost[];
  ownerId: string;
  tokenStatus?: TokenStatus;
  publisherAttention?: boolean;
}): Promise<AccountOperationalSummary> {
  const { ref, posts, ownerId } = params;
  const scoped = filterPostsForAccount(posts, ref.id, ref.platform);

  const playbook = await getPlaybookForAccount(ownerId, ref.id);
  const niche = resolveNicheFromPlaybook(playbook, undefined);
  const playbookConfigured = playbookHasContent(playbook);

  const publishedToday = scoped.filter(
    (post) => post.status === "published" && post.published_at && isToday(parseISO(post.published_at)),
  ).length;

  const pendingCount = scoped.filter(
    (post) => post.status === "pending" || post.status === "retrying",
  ).length;
  const processingCount = scoped.filter((post) => post.status === "processing").length;
  const retryingCount = scoped.filter((post) => post.status === "retrying").length;
  const failedCount = scoped.filter(
    (post) => post.status === "failed" || post.status === "failed_persistent",
  ).length;
  const failedPersistentCount = scoped.filter((post) => post.status === "failed_persistent").length;

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

  const tiktokPending = ref.platform === "tiktok" ? pendingCount : 0;
  const tiktokFailed = ref.platform === "tiktok" ? failedCount : 0;

  const activePosts = scoped.filter((post) =>
    ACTIVE_SLOT_STATUSES.includes(post.status as (typeof ACTIVE_SLOT_STATUSES)[number]),
  );
  const duplicateSlots = detectDuplicateSlots(
    activePosts.map((post) => ({ id: post.id, scheduled_at: post.scheduled_at, status: post.status })),
  );
  const duplicateSlotCount = duplicateSlots.length;

  const postsWithoutCaption = scoped.filter(
    (post) =>
      ACTIVE_SLOT_STATUSES.includes(post.status as (typeof ACTIVE_SLOT_STATUSES)[number]) &&
      !post.caption?.trim(),
  ).length;
  const postsWithoutHashtags = scoped.filter(
    (post) =>
      ACTIVE_SLOT_STATUSES.includes(post.status as (typeof ACTIVE_SLOT_STATUSES)[number]) &&
      extractHashtags(post.caption).length === 0,
  ).length;
  const incompletePosts = scoped.filter(
    (post) =>
      ACTIVE_SLOT_STATUSES.includes(post.status as (typeof ACTIVE_SLOT_STATUSES)[number]) &&
      (!post.caption?.trim() || extractHashtags(post.caption).length === 0),
  ).length;

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

  const rawLastError =
    scoped
      .filter((post) => post.error_message)
      .sort((a, b) => new Date(b.scheduled_at).getTime() - new Date(a.scheduled_at).getTime())[0]
      ?.error_message ?? null;

  const lastError = humanizeLastError(rawLastError);

  const tokenStatus =
    params.tokenStatus ??
    deriveAccountTokenStatus({
      platform: ref.platform,
      igAccount: params.igAccount,
      tiktokAccount: params.tiktokAccount,
    });

  const publishingPaused = Boolean(
    params.igAccount?.publishing_paused ?? params.tiktokAccount?.publishing_paused,
  );

  let health = deriveOperationalHealth({
    tokenStatus,
    failedCount,
    failedPersistentCount,
    retryingCount,
    processingCount,
    storiesBlocked,
    publishingPaused,
    lastError: rawLastError,
    duplicateSlotCount,
    playbookConfigured,
    tiktokAccountStatus: params.tiktokAccount?.status,
  });

  if (params.publisherAttention && health === "healthy") {
    health = "attention";
  }

  const healthPercent = computeOperationalHealthPercent({
    health,
    tokenStatus,
    failedCount,
    failedPersistentCount,
    retryingCount,
    duplicateSlotCount,
    playbookConfigured,
    pendingCount,
  });

  const alerts = buildOperationalAlerts({
    health,
    lastError: rawLastError,
    duplicateSlotCount,
    retryingCount,
    failedPersistentCount,
    playbookConfigured,
    accountId: ref.id,
    platform: ref.platform,
  });

  let statusMessage = "Sua automação está funcionando normalmente.";
  let recommendedAction: string | null = null;

  if (health === "error") {
    statusMessage = "Conta em erro — publicação bloqueada ou instável.";
    recommendedAction =
      isCriticalTikTokError(rawLastError)
        ? "Validar URL ownership no TikTok Developers ou trocar método de upload."
        : "Abra o diagnóstico da conta e resolva token ou falhas persistentes.";
  } else if (health === "attention") {
    statusMessage = "Conta em atenção — revise fila, retry ou configuração.";
    if (duplicateSlotCount > 0) {
      recommendedAction = "Corrigir horários duplicados antes de novos agendamentos.";
    } else if (!playbookConfigured) {
      recommendedAction = "Configure o playbook no Assistente de Conteúdo.";
    } else if (retryingCount > 0) {
      recommendedAction = "Aguarde o cron ou pause publicações se houver rate limit.";
    }
  }

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
    playbookConfigured,
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
    healthPercent,
    statusMessage,
    recommendedAction,
    alerts,
    duplicateSlotCount,
    duplicateSlots,
    processingCount,
    incompletePosts,
    postsWithoutCaption,
    postsWithoutHashtags,
  };
}

export async function buildAllAccountOperationalSummaries(params: {
  refs: OwnerAccountRef[];
  igAccounts: InstagramAccount[];
  tiktokAccounts: TikTokAccount[];
  posts: ScheduledPost[];
  ownerId: string;
  tokenStatusByAccountId?: Record<string, TokenStatus>;
  publisherAttention?: boolean;
}) {
  const igMap = new Map(params.igAccounts.map((account) => [account.id, account]));
  const ttMap = new Map(params.tiktokAccounts.map((account) => [account.id, account]));

  return Promise.all(
    params.refs.map((ref) =>
      buildAccountOperationalSummary({
        ref,
        igAccount: ref.platform === "instagram" ? igMap.get(ref.id) : null,
        tiktokAccount: ref.platform === "tiktok" ? ttMap.get(ref.id) : null,
        posts: params.posts,
        ownerId: params.ownerId,
        tokenStatus: params.tokenStatusByAccountId?.[ref.id],
        publisherAttention: params.publisherAttention,
      }),
    ),
  );
}

export { slotTimeKey };
