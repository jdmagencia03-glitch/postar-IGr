import type { createAdminClient } from "@/lib/supabase/admin";
import {
  handleMissingMediaOnPublish,
  validatePostMediaBeforePublish,
} from "@/lib/media/cron-guard";
import { isAccountInCooldown } from "@/lib/instagram/account-cooldown";
import { normalizeInstagramPublishError } from "@/lib/instagram/errors";
import {
  assertSafeToPublish,
  claimPostForProcessing,
  logPublishEvent,
  markPostFailed,
  markPostPublishCriticalFailure,
  PublishGuardError,
  recoverStaleProcessingPosts,
  releaseProcessingPostAsBlocked,
} from "@/lib/publish/cron";
import { pickPostsForCronRun, accountKey } from "@/lib/publish/queue";
import {
  INSTAGRAM_PUBLISH_COOLDOWN_MS,
  TIKTOK_PUBLISH_COOLDOWN_MS,
} from "@/lib/publish/failure-policy";
import { ensureFutureScheduleSlot } from "@/lib/smart-schedule";
import type { TikTokAccount } from "@/lib/types";

export type PublishPlatform = "instagram" | "tiktok";

export type AdminClient = ReturnType<typeof createAdminClient>;

export type CronPostResult = {
  id: string;
  status: string;
  error?: string;
  skipped?: boolean;
};

export type PlatformPublishResult = {
  containerId?: string;
  mediaId: string;
  permalink?: string | null;
  providerPublishId?: string;
  providerStatus?: string;
  providerResponse?: Record<string, unknown>;
};

export type PlatformCronRunResult = {
  platform: PublishPlatform;
  ok: boolean;
  recovered_stale_processing: number;
  processed: number;
  published: number;
  failed: number;
  skipped: number;
  results: CronPostResult[];
  fatalError?: string;
};

export const STALE_PROCESSING_MS = 20 * 60_000;
export const POSTS_FETCH_LIMIT = 50;
export const RECENTLY_CREATED_GRACE_MS = 5 * 60_000;
export const INSTAGRAM_POSTS_PER_RUN = 5;
export const TIKTOK_POSTS_PER_RUN = 2;

type ScheduledPostRow = Record<string, unknown> & {
  id: string;
  platform?: string | null;
  status: string;
  scheduled_at: string;
  created_at?: string | null;
  media_id?: string | null;
  media_urls?: string[];
  caption?: string | null;
  content_type?: string | null;
  media_type?: string;
  publish_block_reason?: string | null;
  provider_publish_id?: string | null;
  account_id?: string | null;
  tiktok_account_id?: string | null;
  instagram_accounts?: {
    ig_user_id: string;
    page_access_token: string;
    auth_provider?: "instagram" | "facebook" | null;
    publishing_paused?: boolean;
    cooldown_until?: string | null;
    pause_reason?: string | null;
  } | null;
  tiktok_accounts?: TikTokAccount | null;
};

async function loadRecentlyPublishedAccountKeys(supabase: AdminClient, platform: PublishPlatform) {
  const since =
    platform === "instagram"
      ? new Date(Date.now() - INSTAGRAM_PUBLISH_COOLDOWN_MS).toISOString()
      : new Date(Date.now() - TIKTOK_PUBLISH_COOLDOWN_MS).toISOString();
  const keys = new Set<string>();

  if (platform === "instagram") {
    const { data: rows } = await supabase
      .from("scheduled_posts")
      .select("account_id")
      .eq("status", "published")
      .eq("platform", "instagram")
      .gte("published_at", since);

    for (const row of rows ?? []) {
      if (row.account_id) keys.add(`ig:${row.account_id}`);
    }
    return keys;
  }

  const { data: rows } = await supabase
    .from("scheduled_posts")
    .select("tiktok_account_id")
    .eq("status", "published")
    .eq("platform", "tiktok")
    .gte("published_at", since);

  for (const row of rows ?? []) {
    if (row.tiktok_account_id) keys.add(`tiktok:${row.tiktok_account_id}`);
  }

  return keys;
}

async function loadBusyAccountKeys(supabase: AdminClient, platform: PublishPlatform) {
  const keys = new Set<string>();

  const { data: rows } = await supabase
    .from("scheduled_posts")
    .select("account_id, tiktok_account_id, platform")
    .eq("status", "processing")
    .eq("platform", platform)
    .is("media_id", null);

  for (const row of rows ?? []) {
    if (platform === "tiktok" && row.tiktok_account_id) {
      keys.add(`tiktok:${row.tiktok_account_id}`);
    } else if (platform === "instagram" && row.account_id) {
      keys.add(`ig:${row.account_id}`);
    }
  }

  return keys;
}

function isAccountEligibleForPublish(post: ScheduledPostRow, platform: PublishPlatform) {
  if (platform === "instagram") {
    const ig = post.instagram_accounts;
    if (ig?.publishing_paused === true) return false;
    if (isAccountInCooldown(ig?.cooldown_until)) return false;
    return true;
  }

  const ttAccount = post.tiktok_accounts;
  if (!ttAccount) return false;
  if (ttAccount.publishing_paused === true) return false;
  if (ttAccount.status && ttAccount.status !== "active") return false;
  return true;
}

function summarizePlatformResult(
  platform: PublishPlatform,
  params: {
    recovered: number;
    results: CronPostResult[];
    fatalError?: string;
  },
): PlatformCronRunResult {
  const published = params.results.filter((row) => row.status === "published").length;
  const failed = params.results.filter((row) =>
    ["failed", "error", "critical"].includes(row.status),
  ).length;
  const skipped = params.results.filter((row) => Boolean(row.skipped)).length;

  return {
    platform,
    ok: !params.fatalError,
    recovered_stale_processing: params.recovered,
    processed: params.results.length,
    published,
    failed,
    skipped,
    results: params.results,
    fatalError: params.fatalError,
  };
}

async function fetchDuePosts(supabase: AdminClient, platform: PublishPlatform) {
  const now = new Date().toISOString();
  const select =
    platform === "instagram"
      ? "*, instagram_accounts(ig_user_id, page_access_token, auth_provider, publishing_paused, cooldown_until, pause_reason)"
      : "*, tiktok_accounts(*)";

  const { data: pendingPosts, error: pendingError } = await supabase
    .from("scheduled_posts")
    .select(select)
    .eq("platform", platform)
    .eq("status", "pending")
    .lte("scheduled_at", now)
    .is("media_id", null)
    .order("scheduled_at", { ascending: true })
    .limit(POSTS_FETCH_LIMIT);

  const { data: retryPosts, error: retryError } = await supabase
    .from("scheduled_posts")
    .select(select)
    .eq("platform", platform)
    .eq("status", "retrying")
    .lte("next_retry_at", now)
    .is("media_id", null)
    .order("next_retry_at", { ascending: true })
    .limit(POSTS_FETCH_LIMIT);

  const error = pendingError ?? retryError;
  if (error) {
    throw new Error(error.message);
  }

  return [...(pendingPosts ?? []), ...(retryPosts ?? [])].sort(
    (a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime(),
  ) as ScheduledPostRow[];
}

export async function runPlatformPublishCron(params: {
  supabase: AdminClient;
  platform: PublishPlatform;
  postsPerRun: number;
  publishOne: (
    supabase: AdminClient,
    post: ScheduledPostRow,
  ) => Promise<PlatformPublishResult>;
  formatSuccessLog: (post: ScheduledPostRow, result: PlatformPublishResult) => string;
  formatErrorLog?: (error: unknown) => string;
}): Promise<PlatformCronRunResult> {
  const { supabase, platform } = params;

  try {
    const recovered = await recoverStaleProcessingPosts(supabase, STALE_PROCESSING_MS);
    const posts = await fetchDuePosts(supabase, platform);
    const recentlyPublished = await loadRecentlyPublishedAccountKeys(supabase, platform);
    const busyAccounts = await loadBusyAccountKeys(supabase, platform);
    const blockedAccountKeys = new Set([...recentlyPublished, ...busyAccounts]);

    const eligiblePosts = posts.filter((post) => {
      const key = accountKey({
        id: post.id,
        account_id: post.account_id ?? null,
        tiktok_account_id: post.tiktok_account_id ?? null,
        platform: post.platform ?? platform,
      });
      if (blockedAccountKeys.has(key)) return false;
      return isAccountEligibleForPublish(post, platform);
    });

    const postsToProcess = pickPostsForCronRun(
      eligiblePosts.map((post) => ({
        id: post.id,
        account_id: post.account_id ?? null,
        tiktok_account_id: post.tiktok_account_id ?? null,
        platform: post.platform ?? platform,
      })),
      params.postsPerRun,
    );

    const postsById = new Map(eligiblePosts.map((post) => [post.id, post]));
    const results: CronPostResult[] = [];

    for (const queued of postsToProcess) {
      const post = postsById.get(queued.id);
      if (!post) continue;
      if (!isAccountEligibleForPublish(post, platform)) {
        const igAccount = post.instagram_accounts;
        const ttAccount = post.tiktok_accounts;
        const reason =
          platform === "instagram" && isAccountInCooldown(igAccount?.cooldown_until)
            ? `Conta em cooldown até ${igAccount?.cooldown_until ?? "n/d"} (${igAccount?.pause_reason ?? "rate limit"})`
            : platform === "tiktok" && ttAccount?.status && ttAccount.status !== "active"
              ? `Conta TikTok ${ttAccount.status} — reconecte ou valide`
              : "Conta com publicação pausada";
        if (platform === "instagram" && isAccountInCooldown(igAccount?.cooldown_until)) {
          await logPublishEvent(
            supabase,
            post.id,
            "info",
            `account_skipped_cooldown: ${reason}`,
          );
        }
        results.push({ id: post.id, status: "paused", skipped: true, error: reason });
        continue;
      }

      if (busyAccounts.has(accountKey(queued))) {
        results.push({
          id: post.id,
          status: "skipped",
          skipped: true,
          error: "Conta já tem post em processamento",
        });
        continue;
      }

      if (post.media_id) {
        results.push({ id: post.id, status: post.status, skipped: true });
        continue;
      }

      const contentType = post.content_type ?? "reel";
      if (platform === "instagram" && contentType === "story" && post.publish_block_reason) {
        results.push({
          id: post.id,
          status: "blocked",
          skipped: true,
          error: post.publish_block_reason,
        });
        continue;
      }

      const createdAtMs = post.created_at ? new Date(post.created_at).getTime() : 0;
      const scheduledAtMs = new Date(post.scheduled_at).getTime();
      const nowMs = Date.now();

      if (
        createdAtMs > 0 &&
        nowMs - createdAtMs < RECENTLY_CREATED_GRACE_MS &&
        scheduledAtMs <= nowMs
      ) {
        const fixed = ensureFutureScheduleSlot(new Date(post.scheduled_at));
        await supabase
          .from("scheduled_posts")
          .update({ scheduled_at: fixed.toISOString(), updated_at: new Date().toISOString() })
          .eq("id", post.id);
        await logPublishEvent(
          supabase,
          post.id,
          "info",
          `Horário no passado corrigido automaticamente: ${fixed.toISOString()}`,
        );
        results.push({ id: post.id, status: "rescheduled", skipped: true });
        continue;
      }

      let claimed = false;

      if (platform === "instagram") {
        const mediaCheck = await validatePostMediaBeforePublish({
          supabase,
          postId: post.id,
          mediaUrls: post.media_urls ?? [],
          contentType: post.content_type ?? "reel",
        });

        if (!mediaCheck.ok) {
          const { data: igAccount } = post.account_id
            ? await supabase
                .from("instagram_accounts")
                .select("owner_id, user_id")
                .eq("id", post.account_id)
                .maybeSingle()
            : { data: null };

          const ownerId =
            (igAccount?.owner_id as string | null) ??
            (igAccount?.user_id as string | null) ??
            "unknown";

          await handleMissingMediaOnPublish({
            supabase,
            ownerId,
            postId: post.id,
            accountId: post.account_id ?? null,
            platform: "instagram",
            message: mediaCheck.message,
            code: mediaCheck.code,
          });

          results.push({
            id: post.id,
            status: "needs_media",
            skipped: true,
            error: mediaCheck.message,
          });
          continue;
        }
      }

      try {
        claimed = await claimPostForProcessing(supabase, post.id);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Erro ao reservar post";
        results.push({ id: post.id, status: "error", error: message });
        continue;
      }

      if (!claimed) {
        results.push({ id: post.id, status: "skipped", skipped: true });
        continue;
      }

      try {
        await assertSafeToPublish(supabase, post.id);
      } catch (err) {
        if (err instanceof PublishGuardError) {
          await releaseProcessingPostAsBlocked(supabase, post.id, err.message);
          results.push({ id: post.id, status: "blocked", skipped: true, error: err.message });
          continue;
        }
        const message = err instanceof Error ? err.message : "Erro na verificação de segurança";
        await markPostFailed(supabase, post.id, message);
        results.push({ id: post.id, status: "error", error: message });
        continue;
      }

      await logPublishEvent(supabase, post.id, "info", `Iniciando publicação (${platform})`);

      let publishResult: PlatformPublishResult | null = null;

      try {
        publishResult = await params.publishOne(supabase, post);
        await logPublishEvent(
          supabase,
          post.id,
          "success",
          params.formatSuccessLog(post, publishResult),
        );
        results.push({ id: post.id, status: "published" });
      } catch (err) {
        const rawMessage = err instanceof Error ? err.message : "Erro desconhecido";
        const logMessage =
          platform === "instagram"
            ? normalizeInstagramPublishError(params.formatErrorLog?.(err) ?? rawMessage)
            : (params.formatErrorLog?.(err) ?? rawMessage);

        if (publishResult?.mediaId) {
          try {
            await markPostPublishCriticalFailure(
              supabase,
              post.id,
              publishResult.mediaId,
              `Publicado no ${platform}, mas falha ao finalizar registro: ${rawMessage}`,
            );
          } catch (criticalErr) {
            console.error(`[publish/${platform}] critical failure handler error for ${post.id}:`, criticalErr);
          }
          results.push({ id: post.id, status: "critical", error: rawMessage });
          continue;
        }

        await markPostFailed(supabase, post.id, logMessage);
        await logPublishEvent(supabase, post.id, "error", logMessage);
        results.push({ id: post.id, status: "failed", error: rawMessage });
      }
    }

    return summarizePlatformResult(platform, { recovered, results });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha no cron de publicação";
    console.error(`[publish/${platform}] fatal`, error);
    return summarizePlatformResult(platform, {
      recovered: 0,
      results: [],
      fatalError: message,
    });
  }
}

export function toOrchestratorPlatformSummary(result: PlatformCronRunResult) {
  return {
    ok: result.ok,
    processed: result.processed,
    published: result.published,
    failed: result.failed,
    skipped: result.skipped,
    recovered_stale_processing: result.recovered_stale_processing,
    isolated: true,
    ...(result.fatalError ? { error: result.fatalError } : {}),
  };
}
