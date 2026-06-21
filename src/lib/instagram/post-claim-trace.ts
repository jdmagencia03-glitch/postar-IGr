import type { SupabaseClient } from "@supabase/supabase-js";
import { getPublishSuccessEvidence } from "@/lib/instagram/publish-evidence";

/** Idade mínima do lock `processing` para liberação admin (10 min). */
export const ADMIN_STALE_CLAIM_MS = 10 * 60_000;

export type PostClaimStaleReason =
  | "older_than_10_minutes"
  | "worker_dead"
  | "expired_claim";

export type PostClaimBlockReason =
  | "status_processing"
  | "status_failed_needs_prepare"
  | "status_retrying_not_due"
  | "status_not_claimable";

export type PostClaimTrace = {
  currentStatus: string;
  /** Neste projeto o claim é o status `processing` em scheduled_posts (sem colunas claimed_by). */
  claimMechanism: "scheduled_posts.status";
  claimedBy: string | null;
  claimedAt: string | null;
  processingStartedAt: string | null;
  processingExpiresAt: string | null;
  lastAttemptAt: string | null;
  claimBlockReason: PostClaimBlockReason | null;
  isStale: boolean;
  staleReason: PostClaimStaleReason | null;
  isActivelyProcessing: boolean;
  updatedAt: string | null;
  nextRetryAt: string | null;
  retryCount: number;
};

function pickLatestIso(values: Array<string | null | undefined>) {
  const valid = values.filter(Boolean) as string[];
  if (valid.length === 0) return null;
  return valid.sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] ?? null;
}

export function inferClaimBlockReason(post: {
  status: string;
  next_retry_at?: string | null;
}): PostClaimBlockReason | null {
  const now = Date.now();
  if (post.status === "processing") return "status_processing";
  if (post.status === "failed" || post.status === "failed_persistent") {
    return "status_failed_needs_prepare";
  }
  if (post.status === "retrying") {
    if (post.next_retry_at && new Date(post.next_retry_at).getTime() > now) {
      return "status_retrying_not_due";
    }
    return null;
  }
  if (post.status === "pending") return null;
  return "status_not_claimable";
}

export async function buildPostClaimTrace(
  supabase: SupabaseClient,
  post: {
    id: string;
    status: string;
    updated_at?: string | null;
    next_retry_at?: string | null;
    retry_count?: number | null;
  },
): Promise<PostClaimTrace> {
  const { data: logs } = await supabase
    .from("publish_logs")
    .select("message, created_at, level")
    .eq("post_id", post.id)
    .order("created_at", { ascending: false })
    .limit(30);

  const lastAttemptAt = logs?.[0]?.created_at ?? null;
  const lastStartLog = (logs ?? []).find(
    (row) => row.level === "info" && /iniciando publicação/i.test(row.message),
  );
  const processingStartedAt =
    post.status === "processing"
      ? pickLatestIso([lastStartLog?.created_at, post.updated_at])
      : lastStartLog?.created_at ?? null;

  const startedMs = processingStartedAt ? new Date(processingStartedAt).getTime() : null;
  const ageMs = startedMs ? Date.now() - startedMs : null;
  const isStale =
    post.status === "processing" &&
    startedMs !== null &&
    ageMs !== null &&
    ageMs >= ADMIN_STALE_CLAIM_MS;

  let staleReason: PostClaimStaleReason | null = null;
  if (isStale) {
    staleReason = "older_than_10_minutes";
    if (lastStartLog && post.updated_at) {
      const gap = Math.abs(
        new Date(post.updated_at).getTime() - new Date(lastStartLog.created_at).getTime(),
      );
      if (gap > ADMIN_STALE_CLAIM_MS * 2) staleReason = "worker_dead";
    }
    if (
      post.updated_at &&
      Date.now() - new Date(post.updated_at).getTime() >= ADMIN_STALE_CLAIM_MS
    ) {
      staleReason = staleReason ?? "expired_claim";
    }
  }

  const processingExpiresAt =
    startedMs !== null
      ? new Date(startedMs + ADMIN_STALE_CLAIM_MS).toISOString()
      : null;

  return {
    currentStatus: post.status,
    claimMechanism: "scheduled_posts.status",
    claimedBy: post.status === "processing" ? "status:processing" : null,
    claimedAt: post.status === "processing" ? (post.updated_at ?? processingStartedAt) : null,
    processingStartedAt,
    processingExpiresAt,
    lastAttemptAt,
    claimBlockReason: inferClaimBlockReason(post),
    isStale,
    staleReason,
    isActivelyProcessing: post.status === "processing" && !isStale,
    updatedAt: post.updated_at ?? null,
    nextRetryAt: post.next_retry_at ?? null,
    retryCount: post.retry_count ?? 0,
  };
}

export type ReleaseStaleClaimSafety = {
  ok: boolean;
  publishingPaused: boolean;
  hasPublishEvidence: boolean;
  publishEvidence: Awaited<ReturnType<typeof getPublishSuccessEvidence>>;
  claim: PostClaimTrace;
  warnings: string[];
  canReleaseClaim: boolean;
  recommendedAction:
    | "release_stale_claim_then_retry"
    | "retry_prepares_status"
    | "wait_for_active_processing"
    | "manual_review";
};

export async function evaluateReleaseStaleClaim(params: {
  supabase: SupabaseClient;
  post: {
    id: string;
    account_id: string;
    status: string;
    media_id: string | null;
    permalink: string | null;
    media_urls: string[] | null;
    error_message: string | null;
    updated_at?: string | null;
    next_retry_at?: string | null;
    retry_count?: number | null;
  };
  account: { publishing_paused?: boolean | null };
}): Promise<ReleaseStaleClaimSafety> {
  const warnings: string[] = [];
  const claim = await buildPostClaimTrace(params.supabase, params.post);
  const publishEvidence = await getPublishSuccessEvidence(params.supabase, {
    id: params.post.id,
    status: params.post.status,
    media_id: params.post.media_id,
    permalink: params.post.permalink,
    account_id: params.post.account_id,
    media_urls: params.post.media_urls,
  });

  const publishingPaused = params.account.publishing_paused === true;
  if (!publishingPaused) {
    warnings.push("Conta não está pausada — liberação bloqueada.");
  }
  if (publishEvidence.hasEvidence) {
    warnings.push("Existe evidência de publicação — liberação bloqueada.");
  }
  if (params.post.status === "published") {
    warnings.push("Post já publicado.");
  }

  const canReleaseClaim =
    publishingPaused &&
    !publishEvidence.hasEvidence &&
    params.post.status === "processing" &&
    claim.isStale &&
    !params.post.media_id &&
    !params.post.permalink;

  let recommendedAction: ReleaseStaleClaimSafety["recommendedAction"] = "manual_review";
  if (canReleaseClaim) {
    recommendedAction = "release_stale_claim_then_retry";
  } else if (claim.claimBlockReason === "status_failed_needs_prepare") {
    recommendedAction = "retry_prepares_status";
  } else if (claim.isActivelyProcessing) {
    recommendedAction = "wait_for_active_processing";
  }

  return {
    ok: publishingPaused && !publishEvidence.hasEvidence && params.post.status !== "published",
    publishingPaused,
    hasPublishEvidence: publishEvidence.hasEvidence,
    publishEvidence,
    claim,
    warnings,
    canReleaseClaim,
    recommendedAction,
  };
}
