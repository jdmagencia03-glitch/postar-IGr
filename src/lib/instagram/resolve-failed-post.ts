import type { SupabaseClient } from "@supabase/supabase-js";
import { getInstagramAccountForAdmin } from "@/lib/instagram/admin-gate";
import {
  buildDuplicateGuardTrace,
  resolveOperationalErrorsForPost,
} from "@/lib/instagram/duplicate-guard-trace";
import {
  INSTAGRAM_RATE_LIMIT_CODE,
  isInstagramRateLimitError,
} from "@/lib/instagram/errors";
import { logPublishEvent } from "@/lib/publish/cron";

export type ResolveFailedPostAction =
  | "cancel_as_rate_limited_abandoned";

const ADMIN_CANCEL_MESSAGE =
  "Cancelado por revisão admin: falha antiga por rate limit/action block do Instagram. Não há evidência de publicação.";

async function hasDominantRateLimitInLogs(supabase: SupabaseClient, postId: string) {
  const { data: logs } = await supabase
    .from("publish_logs")
    .select("message, level, created_at")
    .eq("post_id", postId)
    .order("created_at", { ascending: false })
    .limit(50);

  const rateLimitCount = (logs ?? []).filter((row) => isInstagramRateLimitError(row.message)).length;
  return {
    rateLimitCount,
    dominant: rateLimitCount > 0,
    recentMessages: (logs ?? []).slice(0, 5).map((row) => row.message),
  };
}

export async function resolveInstagramFailedPost(params: {
  supabase: SupabaseClient;
  ownerId: string;
  accountId: string;
  postId: string;
  action: ResolveFailedPostAction;
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
      "id, account_id, caption, media_urls, container_id, media_id, permalink, error_message, status, platform, retry_count",
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

  const trace = await buildDuplicateGuardTrace({ supabase: params.supabase, post });
  const rateLimitLogs = await hasDominantRateLimitInLogs(params.supabase, params.postId);
  const hasRateLimitError =
    isInstagramRateLimitError(post.error_message) || rateLimitLogs.dominant;

  const dryRunPayload = {
    ok: true as const,
    dryRun: true as const,
    postId: params.postId,
    accountId: params.accountId,
    ownerId: params.ownerId,
    currentStatus: post.status,
    requestedAction: params.action,
    resolvedAction: params.action,
    trace,
    rateLimitLogs,
    hasRateLimitError,
    wouldApply: false,
    warnings: [] as string[],
    checks: {
      noSuccessLog: !trace.hasExactPostSuccessLog,
      noInstagramMediaId: !trace.hasInstagramMediaId,
      noSameMediaSuccess: !trace.hasSameMediaSuccessLog,
      dominantRateLimit: hasRateLimitError,
    },
  };

  if (trace.hasExactPostSuccessLog || trace.hasInstagramMediaId) {
    dryRunPayload.warnings.push("Existe evidência de publicação — cancelamento bloqueado.");
    return dryRunPayload;
  }

  if (!hasRateLimitError) {
    dryRunPayload.warnings.push("Erro dominante não é rate limit/action block.");
    return dryRunPayload;
  }

  dryRunPayload.wouldApply = true;

  if (!params.confirm) {
    return dryRunPayload;
  }

  const now = new Date().toISOString();
  const { error: updateError } = await params.supabase
    .from("scheduled_posts")
    .update({
      status: "cancelled",
      cancel_reason: INSTAGRAM_RATE_LIMIT_CODE,
      error_message: ADMIN_CANCEL_MESSAGE,
      next_retry_at: null,
      updated_at: now,
    })
    .eq("id", params.postId)
    .eq("account_id", params.accountId);

  if (updateError) {
    return { ok: false as const, error: "update_failed" as const, message: updateError.message };
  }

  await logPublishEvent(
    params.supabase,
    params.postId,
    "info",
    `Admin resolve-failed-post: cancelado (${INSTAGRAM_RATE_LIMIT_CODE}).`,
  );

  await resolveOperationalErrorsForPost(
    params.supabase,
    params.ownerId,
    params.postId,
    "resolved_by_admin_cancel_rate_limit",
  );

  return {
    ok: true as const,
    dryRun: false as const,
    applied: params.action,
    postId: params.postId,
    cancelReason: INSTAGRAM_RATE_LIMIT_CODE,
    errorMessage: ADMIN_CANCEL_MESSAGE,
    trace,
    rateLimitLogs,
  };
}
