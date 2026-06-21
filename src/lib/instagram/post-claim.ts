import type { SupabaseClient } from "@supabase/supabase-js";

/** Idade mínima do lock `processing` para liberar via admin. */
export const STALE_CLAIM_MS = 10 * 60_000;

export type StaleClaimReason =
  | "older_than_10_minutes"
  | "worker_dead"
  | "expired_claim"
  | null;

export type ClaimBlockReason =
  | "status_processing"
  | "status_not_claimable"
  | "next_retry_at_in_future"
  | null;

export type PostClaimTrace = {
  /** Lock real: `scheduled_posts.status = processing` (não há claimed_by/lock_until nesta tabela). */
  lockMechanism: "scheduled_posts.status";
  currentStatus: string;
  claimedBy: string | null;
  claimedAt: string | null;
  processingStartedAt: string | null;
  processingExpiresAt: string | null;
  lastAttemptAt: string | null;
  isStale: boolean;
  staleReason: StaleClaimReason;
  claimBlockReason: ClaimBlockReason;
  isLocked: boolean;
  updatedAt: string | null;
  nextRetryAt: string | null;
  retryCount: number;
};

type PostRow = {
  id: string;
  status: string;
  updated_at: string;
  next_retry_at: string | null;
  retry_count: number | null;
};

async function loadLastProcessingStart(supabase: SupabaseClient, postId: string) {
  const { data } = await supabase
    .from("publish_logs")
    .select("created_at, message")
    .eq("post_id", postId)
    .eq("level", "info")
    .ilike("message", "Iniciando publicação%")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return data?.created_at ?? null;
}

async function loadLastAttemptAt(supabase: SupabaseClient, postId: string) {
  const { data } = await supabase
    .from("publish_logs")
    .select("created_at")
    .eq("post_id", postId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return data?.created_at ?? null;
}

export function computeClaimBlockReason(post: PostRow, now = Date.now()): ClaimBlockReason {
  if (post.status === "processing") {
    return "status_processing";
  }
  if (post.status === "retrying" && post.next_retry_at) {
    if (new Date(post.next_retry_at).getTime() > now) {
      return "next_retry_at_in_future";
    }
    return null;
  }
  if (["pending", "retrying"].includes(post.status)) {
    return null;
  }
  if (["failed", "failed_persistent"].includes(post.status)) {
    return "status_not_claimable";
  }
  return "status_not_claimable";
}

export function computeStaleClaim(params: {
  status: string;
  updatedAt: string | null;
  processingStartedAt: string | null;
  now?: number;
}) {
  const now = params.now ?? Date.now();

  if (params.status !== "processing") {
    return { isStale: false, staleReason: null as StaleClaimReason };
  }

  const startedMs = params.processingStartedAt
    ? new Date(params.processingStartedAt).getTime()
    : params.updatedAt
      ? new Date(params.updatedAt).getTime()
      : null;

  if (startedMs == null) {
    return { isStale: true, staleReason: "worker_dead" as const };
  }

  const ageMs = now - startedMs;
  if (ageMs >= STALE_CLAIM_MS) {
    return { isStale: true, staleReason: "older_than_10_minutes" as const };
  }

  const expiresAt = new Date(startedMs + STALE_CLAIM_MS);
  if (expiresAt.getTime() <= now) {
    return { isStale: true, staleReason: "expired_claim" as const };
  }

  return { isStale: false, staleReason: null as StaleClaimReason };
}

export async function buildPostClaimTrace(
  supabase: SupabaseClient,
  post: PostRow,
): Promise<PostClaimTrace> {
  const processingStartedAt = await loadLastProcessingStart(supabase, post.id);
  const lastAttemptAt = await loadLastAttemptAt(supabase, post.id);
  const claimBlockReason = computeClaimBlockReason(post);
  const { isStale, staleReason } = computeStaleClaim({
    status: post.status,
    updatedAt: post.updated_at,
    processingStartedAt,
  });

  const isLocked = post.status === "processing";
  const claimedAt = isLocked ? post.updated_at : null;
  const startedAt = isLocked ? (processingStartedAt ?? post.updated_at) : processingStartedAt;
  const processingExpiresAt =
    startedAt != null
      ? new Date(new Date(startedAt).getTime() + STALE_CLAIM_MS).toISOString()
      : null;

  return {
    lockMechanism: "scheduled_posts.status",
    currentStatus: post.status,
    claimedBy: isLocked ? "implicit:status=processing" : null,
    claimedAt,
    processingStartedAt: startedAt,
    processingExpiresAt,
    lastAttemptAt,
    isStale: isLocked && isStale,
    staleReason: isLocked ? staleReason : null,
    claimBlockReason,
    isLocked,
    updatedAt: post.updated_at,
    nextRetryAt: post.next_retry_at,
    retryCount: post.retry_count ?? 0,
  };
}

export function canReleaseStaleClaim(trace: PostClaimTrace) {
  return trace.isLocked && trace.isStale;
}

export function recommendedClaimAction(trace: PostClaimTrace) {
  if (canReleaseStaleClaim(trace)) {
    return "release_stale_claim_then_retry" as const;
  }
  if (trace.claimBlockReason === "status_not_claimable") {
    return "prepare_status_then_retry" as const;
  }
  if (trace.claimBlockReason === "next_retry_at_in_future") {
    return "release_stale_claim_then_retry" as const;
  }
  if (trace.isLocked && !trace.isStale) {
    return "wait_or_release_when_stale" as const;
  }
  return "retry_one_post_confirm_true" as const;
}
