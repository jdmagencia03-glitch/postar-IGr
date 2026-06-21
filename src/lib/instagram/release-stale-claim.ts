import type { SupabaseClient } from "@supabase/supabase-js";
import { getInstagramAccountForAdmin } from "@/lib/instagram/admin-gate";
import {
  buildPostClaimTrace,
  canReleaseStaleClaim,
  recommendedClaimAction,
  type PostClaimTrace,
} from "@/lib/instagram/post-claim";
import { getPublishSuccessEvidence } from "@/lib/instagram/publish-evidence";
import { logPublishEvent } from "@/lib/publish/cron";

export async function releaseInstagramStaleClaim(params: {
  supabase: SupabaseClient;
  ownerId: string;
  accountId: string;
  postId: string;
  confirm: boolean;
}) {
  const account = await getInstagramAccountForAdmin(
    params.supabase,
    params.ownerId,
    params.accountId,
  );

  if (!account) {
    return { ok: false as const, error: "account_not_found" as const };
  }

  const { data: post, error: postError } = await params.supabase
    .from("scheduled_posts")
    .select(
      "id, account_id, status, media_id, permalink, media_urls, error_message, updated_at, next_retry_at, retry_count, platform",
    )
    .eq("id", params.postId)
    .eq("account_id", params.accountId)
    .maybeSingle();

  if (postError || !post) {
    return { ok: false as const, error: "post_not_found" as const };
  }

  if (post.platform && post.platform !== "instagram") {
    return { ok: false as const, error: "not_instagram_post" as const };
  }

  const evidence = await getPublishSuccessEvidence(params.supabase, {
    id: post.id,
    status: post.status,
    media_id: post.media_id,
    permalink: post.permalink,
    account_id: post.account_id,
    media_urls: post.media_urls,
  });

  const claim = await buildPostClaimTrace(params.supabase, {
    id: post.id,
    status: post.status,
    updated_at: post.updated_at,
    next_retry_at: post.next_retry_at,
    retry_count: post.retry_count,
  });

  const checks = {
    accountPaused: Boolean(account.publishing_paused),
    postBelongsToAccount: post.account_id === params.accountId,
    noInstagramMediaId: !post.media_id,
    noPermalink: !post.permalink,
    noSuccessLog: !evidence.reasons.includes("success_log"),
    noSameMediaSuccess: !evidence.reasons.includes("same_media_success"),
    notPublished: post.status !== "published",
    lockStaleOrBlocked:
      canReleaseStaleClaim(claim) ||
      claim.claimBlockReason === "status_not_claimable" ||
      claim.claimBlockReason === "next_retry_at_in_future",
  };

  const warnings: string[] = [];
  if (!checks.accountPaused) {
    warnings.push("Conta não está pausada — liberação bloqueada.");
  }
  if (evidence.hasEvidence) {
    warnings.push("Existe evidência de publicação — liberação bloqueada.");
  }
  if (post.status === "processing" && !claim.isStale) {
    warnings.push("Lock processing ainda não está obsoleto (< 10 min).");
  }
  if (post.status !== "processing" && claim.claimBlockReason === "status_not_claimable") {
    warnings.push(
      "Post não está em processing — será preparado para retry (status → pending) se confirmado.",
    );
  }

  const canRelease =
    checks.accountPaused &&
    checks.postBelongsToAccount &&
    checks.noInstagramMediaId &&
    checks.noPermalink &&
    checks.noSuccessLog &&
    checks.noSameMediaSuccess &&
    checks.notPublished &&
    !evidence.hasEvidence &&
    (canReleaseStaleClaim(claim) ||
      claim.claimBlockReason === "status_not_claimable" ||
      claim.claimBlockReason === "next_retry_at_in_future");

  const dryRunPayload = {
    ok: true as const,
    dryRun: true as const,
    postId: params.postId,
    accountId: params.accountId,
    ownerId: params.ownerId,
    claim,
    checks,
    evidence,
    canReleaseClaim: canRelease,
    recommendedAction: recommendedClaimAction(claim),
    wouldApply: canRelease,
    warnings,
    lockFieldsNote:
      "scheduled_posts não possui claimed_by/lock_until — o lock é status=processing; liberação altera apenas status/next_retry_at.",
  };

  if (!params.confirm) {
    return dryRunPayload;
  }

  if (!canRelease) {
    return {
      ok: false as const,
      error: "release_not_allowed" as const,
      claim,
      checks,
      warnings,
    };
  }

  const now = new Date().toISOString();
  const previousClaim: PostClaimTrace = { ...claim };

  if (post.status === "processing") {
    const releaseStatus =
      (post.retry_count ?? 0) >= 3 ? ("failed_persistent" as const) : ("failed" as const);

    const { error: updateError } = await params.supabase
      .from("scheduled_posts")
      .update({
        status: releaseStatus,
        updated_at: now,
      })
      .eq("id", params.postId)
      .eq("account_id", params.accountId)
      .eq("status", "processing")
      .is("media_id", null);

    if (updateError) {
      return { ok: false as const, error: "update_failed" as const, message: updateError.message };
    }

    await logPublishEvent(
      params.supabase,
      params.postId,
      "info",
      `Admin release-stale-claim: processing → ${releaseStatus} (lock liberado, mídia/caption/scheduled_at intactos).`,
    );
  } else if (
    ["failed", "failed_persistent", "retrying"].includes(post.status) ||
    claim.claimBlockReason === "next_retry_at_in_future"
  ) {
    const { error: updateError } = await params.supabase
      .from("scheduled_posts")
      .update({
        status: "pending",
        next_retry_at: null,
        updated_at: now,
      })
      .eq("id", params.postId)
      .eq("account_id", params.accountId)
      .in("status", ["failed", "failed_persistent", "retrying"])
      .is("media_id", null);

    if (updateError) {
      return { ok: false as const, error: "update_failed" as const, message: updateError.message };
    }

    await logPublishEvent(
      params.supabase,
      params.postId,
      "info",
      "Admin release-stale-claim: status preparado para pending (claim liberado para retry manual).",
    );
  }

  return {
    ok: true as const,
    dryRun: false as const,
    released: true as const,
    postId: params.postId,
    previousClaim,
    nextStep: "retry_one_post_confirm_true" as const,
    warnings,
  };
}
