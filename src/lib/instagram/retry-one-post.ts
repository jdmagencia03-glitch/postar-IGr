import type { SupabaseClient } from "@supabase/supabase-js";
import { getAccountAccessToken } from "@/lib/accounts";
import { getInstagramAccountForAdmin } from "@/lib/instagram/admin-gate";
import { probeVideoUrl } from "@/lib/instagram/video-probe";
import {
  formatInstagramPublishError,
  publishPost,
} from "@/lib/meta/instagram";
import { isInstagramContainerProcessingError } from "@/lib/meta/instagram-container";
import {
  assertSafeToPublish,
  claimPostForProcessing,
  logPublishEvent,
  markPostFailed,
  markPostPublished,
} from "@/lib/publish/cron";
import {
  buildPostClaimTrace,
  canReleaseStaleClaim,
  recommendedClaimAction,
} from "@/lib/instagram/post-claim";
import type { MediaType } from "@/lib/types";

async function preparePostForAdminClaim(
  supabase: SupabaseClient,
  post: {
    id: string;
    status: string;
    next_retry_at: string | null;
  },
) {
  const now = new Date().toISOString();

  if (post.status === "pending") {
    return { prepared: true as const };
  }

  if (post.status === "processing") {
    return { prepared: false as const, reason: "status_processing" as const };
  }

  if (post.status === "retrying") {
    const { data, error } = await supabase
      .from("scheduled_posts")
      .update({ next_retry_at: now, updated_at: now })
      .eq("id", post.id)
      .eq("status", "retrying")
      .is("media_id", null)
      .select("id")
      .maybeSingle();

    if (error || !data) {
      return { prepared: false as const, reason: "prepare_failed" as const };
    }

    await logPublishEvent(
      supabase,
      post.id,
      "info",
      "Admin retry: next_retry_at antecipado para permitir claim.",
    );
    return { prepared: true as const };
  }

  if (["failed", "failed_persistent"].includes(post.status)) {
    const { data, error } = await supabase
      .from("scheduled_posts")
      .update({
        status: "pending",
        next_retry_at: null,
        updated_at: now,
      })
      .eq("id", post.id)
      .in("status", ["failed", "failed_persistent"])
      .is("media_id", null)
      .select("id")
      .maybeSingle();

    if (error || !data) {
      return { prepared: false as const, reason: "prepare_failed" as const };
    }

    await logPublishEvent(
      supabase,
      post.id,
      "info",
      `Admin retry: status ${post.status} → pending para permitir claim.`,
    );
    return { prepared: true as const };
  }

  return { prepared: false as const, reason: "status_not_claimable" as const };
}

export async function buildInstagramRetryOnePostPlan(params: {
  supabase: SupabaseClient;
  ownerId: string;
  accountId: string;
  postId: string;
  confirm: boolean;
  forceNewContainer?: boolean;
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
      "*, instagram_accounts(ig_user_id, page_access_token, auth_provider, ig_username)",
    )
    .eq("id", params.postId)
    .eq("account_id", params.accountId)
    .maybeSingle();

  if (postError || !post) {
    return { ok: false as const, error: "post_not_found" as const };
  }

  const videoUrl = post.media_urls?.[0] ?? null;
  const videoProbe = await probeVideoUrl(videoUrl);
  const warnings: string[] = [];

  if (!account.publishing_paused) {
    warnings.push("Conta não está pausada — recomendado pausar antes do retry manual.");
  }
  if (!videoProbe.videoUrlAccessible) {
    warnings.push("videoUrl inacessível — retry provavelmente falhará.");
  }
  if (post.media_id) {
    warnings.push("Post já possui media_id — republicação bloqueada.");
  }
  if (post.container_id) {
    warnings.push(
      `Container anterior ${post.container_id} será registrado nos logs e substituído por um novo container.`,
    );
  }

  const canRetry =
    Boolean(videoUrl) &&
    !post.media_id &&
    ["failed", "failed_persistent", "retrying", "processing", "pending"].includes(post.status);

  const claim = await buildPostClaimTrace(params.supabase, {
    id: post.id,
    status: post.status,
    updated_at: post.updated_at,
    next_retry_at: post.next_retry_at,
    retry_count: post.retry_count,
  });

  if (!params.confirm) {
    return {
      ok: true as const,
      dryRun: true as const,
      canRetry,
      wouldCreateNewContainer: params.forceNewContainer !== false,
      videoUrlAccessible: videoProbe.videoUrlAccessible,
      willNotReuseOldContainer: true,
      postId: params.postId,
      accountId: params.accountId,
      ownerId: params.ownerId,
      currentStatus: post.status,
      oldContainerId: post.container_id,
      videoUrl,
      claim,
      canReleaseClaim: canReleaseStaleClaim(claim),
      recommendedAction: recommendedClaimAction(claim),
      warnings,
    };
  }

  if (!canRetry) {
    return {
      ok: false as const,
      error: "cannot_retry" as const,
      warnings,
    };
  }

  try {
    await assertSafeToPublish(params.supabase, post.id);
  } catch (err) {
    return {
      ok: false as const,
      error: "unsafe_to_retry" as const,
      message: err instanceof Error ? err.message : "Retry bloqueado",
      claim,
      warnings,
    };
  }

  if (post.status === "processing") {
    return {
      ok: false as const,
      error: "claim_failed" as const,
      message: claim.isStale
        ? "Post preso em processing — use release-stale-claim antes do retry."
        : "Post em processamento ativo — aguarde ou use release-stale-claim quando obsoleto.",
      claim,
      canReleaseClaim: canReleaseStaleClaim(claim),
      recommendedAction: recommendedClaimAction(claim),
      warnings,
    };
  }

  const prepared = await preparePostForAdminClaim(params.supabase, {
    id: post.id,
    status: post.status,
    next_retry_at: post.next_retry_at,
  });

  if (!prepared.prepared) {
    const freshClaim = await buildPostClaimTrace(params.supabase, {
      id: post.id,
      status: post.status,
      updated_at: post.updated_at,
      next_retry_at: post.next_retry_at,
      retry_count: post.retry_count,
    });
    return {
      ok: false as const,
      error: "claim_failed" as const,
      message: "Não foi possível preparar o post para claim",
      claim: freshClaim,
      canReleaseClaim: canReleaseStaleClaim(freshClaim),
      recommendedAction: recommendedClaimAction(freshClaim),
      warnings,
    };
  }

  const claimed = await claimPostForProcessing(params.supabase, post.id);
  if (!claimed) {
    const { data: freshPost } = await params.supabase
      .from("scheduled_posts")
      .select("status, updated_at, next_retry_at, retry_count")
      .eq("id", post.id)
      .maybeSingle();

    const freshClaim = freshPost
      ? await buildPostClaimTrace(params.supabase, {
          id: post.id,
          status: freshPost.status,
          updated_at: freshPost.updated_at,
          next_retry_at: freshPost.next_retry_at,
          retry_count: freshPost.retry_count,
        })
      : claim;

    return {
      ok: false as const,
      error: "claim_failed" as const,
      message:
        freshClaim.currentStatus === "processing"
          ? "Post em processamento por outro worker"
          : `Claim falhou — status atual: ${freshClaim.currentStatus}`,
      claim: freshClaim,
      canReleaseClaim: canReleaseStaleClaim(freshClaim),
      recommendedAction: recommendedClaimAction(freshClaim),
      warnings,
    };
  }

  const oldContainerId = post.container_id;
  const shouldReplaceContainer = params.forceNewContainer !== false;

  if (shouldReplaceContainer && oldContainerId) {
    await logPublishEvent(
      params.supabase,
      post.id,
      "info",
      `Admin retry: descartando container anterior ${oldContainerId} (novo container será criado).`,
    );
    await params.supabase
      .from("scheduled_posts")
      .update({ container_id: null })
      .eq("id", post.id);
  }

  if (shouldReplaceContainer && !oldContainerId) {
    await logPublishEvent(
      params.supabase,
      post.id,
      "info",
      "Admin retry: novo container será criado (forceNewContainer).",
    );
  }

  await logPublishEvent(
    params.supabase,
    post.id,
    "info",
    "Admin retry manual iniciado (1 post, novo container).",
  );

  const igAccount = post.instagram_accounts;
  if (!igAccount) {
    await markPostFailed(params.supabase, post.id, "Conta Instagram não encontrada");
    return { ok: false as const, error: "missing_account_secrets" as const, warnings };
  }

  const accessToken = getAccountAccessToken(igAccount);
  if (!accessToken) {
    await markPostFailed(params.supabase, post.id, "Token da conta indisponível");
    return { ok: false as const, error: "missing_token" as const, warnings };
  }

  const provider = igAccount.auth_provider === "facebook" ? "facebook" : "instagram";

  try {
    const result = await publishPost({
      igUserId: igAccount.ig_user_id,
      token: accessToken,
      mediaType: (post.media_type ?? "REELS") as MediaType,
      mediaUrls: post.media_urls ?? [],
      caption: post.caption ?? undefined,
      provider,
    });

    await markPostPublished(params.supabase, post.id, {
      container_id: result.containerId,
      media_id: result.mediaId,
      permalink: result.permalink,
    });

    await logPublishEvent(
      params.supabase,
      post.id,
      "success",
      `Admin retry publicado: ${result.permalink ?? result.mediaId}`,
    );

    return {
      ok: true as const,
      dryRun: false as const,
      published: true as const,
      postId: post.id,
      containerId: result.containerId,
      mediaId: result.mediaId,
      permalink: result.permalink,
      oldContainerId,
      warnings,
    };
  } catch (err) {
    const message = formatInstagramPublishError(err);

    if (isInstagramContainerProcessingError(err)) {
      await params.supabase
        .from("scheduled_posts")
        .update({ container_id: err.containerId })
        .eq("id", post.id);
    }

    await markPostFailed(params.supabase, post.id, message);
    await logPublishEvent(params.supabase, post.id, "error", message);

    return {
      ok: false as const,
      published: false as const,
      error: "publish_failed" as const,
      message,
      postId: post.id,
      oldContainerId,
      newContainerId: isInstagramContainerProcessingError(err) ? err.containerId : null,
      warnings,
    };
  }
}
