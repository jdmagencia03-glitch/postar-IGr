import type { SupabaseClient } from "@supabase/supabase-js";
import { getInstagramAccountForAdmin } from "@/lib/instagram/admin-gate";
import {
  buildDuplicateGuardTrace,
  parsePublishedFromSuccessLog,
  resolveOperationalErrorsForPost,
  type DuplicateGuardRecommendedAction,
} from "@/lib/instagram/duplicate-guard-trace";
import { logPublishEvent } from "@/lib/publish/cron";

export type ResolveDuplicateGuardAction =
  | "auto"
  | "mark_as_published"
  | "cancel_as_duplicate"
  | "manual_review";

export async function resolveInstagramDuplicateGuard(params: {
  supabase: SupabaseClient;
  ownerId: string;
  accountId: string;
  postId: string;
  action: ResolveDuplicateGuardAction;
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
      "id, account_id, caption, media_urls, container_id, media_id, permalink, error_message, status, platform",
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

  let resolvedAction: DuplicateGuardRecommendedAction | "manual_review" =
    params.action === "auto" ? trace.recommendedAction : params.action;

  if (resolvedAction === "safe_retry_possible") {
    resolvedAction = "manual_review";
  }

  const dryRunPayload = {
    ok: true as const,
    dryRun: true as const,
    postId: params.postId,
    accountId: params.accountId,
    ownerId: params.ownerId,
    currentStatus: post.status,
    requestedAction: params.action,
    resolvedAction,
    trace,
    wouldApply: resolvedAction !== "manual_review",
    warnings: [] as string[],
  };

  if (resolvedAction === "manual_review") {
    dryRunPayload.warnings.push(
      "Evidência insuficiente para marcar como publicado ou cancelar automaticamente.",
    );
  }

  if (resolvedAction === "mark_as_published" && !trace.hasExactPostSuccessLog) {
    dryRunPayload.warnings.push("Sem log de sucesso exato neste post_id.");
    resolvedAction = "manual_review";
    dryRunPayload.resolvedAction = "manual_review";
    dryRunPayload.wouldApply = false;
  }

  if (resolvedAction === "cancel_as_duplicate" && !trace.hasSameMediaSuccessLog && !trace.hasExactPostSuccessLog) {
    dryRunPayload.warnings.push("Sem evidência de duplicidade por URL ou log.");
  }

  if (!params.confirm) {
    return dryRunPayload;
  }

  if (resolvedAction === "manual_review") {
    return {
      ok: false as const,
      error: "manual_review_required" as const,
      trace,
      message: "Ação manual necessária — nenhuma alteração feita.",
    };
  }

  const now = new Date().toISOString();

  if (resolvedAction === "mark_as_published") {
    const successLog = trace.matchedSuccessLogs[0];
    const parsed = successLog ? parsePublishedFromSuccessLog(successLog.message) : null;
    const mediaId = trace.instagramMediaId ?? parsed?.mediaId ?? null;
    const permalink = trace.instagramPermalink ?? parsed?.permalink ?? null;

    const { error: updateError } = await params.supabase
      .from("scheduled_posts")
      .update({
        status: "published",
        media_id: mediaId,
        permalink,
        published_at: now,
        error_message: null,
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
      `Admin resolve-duplicate-guard: marcado como published (media_id=${mediaId ?? "n/a"}).`,
    );

    await resolveOperationalErrorsForPost(params.supabase, params.ownerId, params.postId);

    return {
      ok: true as const,
      dryRun: false as const,
      applied: "mark_as_published" as const,
      postId: params.postId,
      mediaId,
      permalink,
      trace,
    };
  }

  if (resolvedAction === "cancel_as_duplicate") {
    const reason = trace.hasSameMediaSuccessLog
      ? "duplicate_guard_same_media_success_log"
      : "duplicate_guard_success_log_found";

    const { error: updateError } = await params.supabase
      .from("scheduled_posts")
      .update({
        status: "cancelled",
        cancel_reason: reason,
        error_message: post.error_message,
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
      `Admin resolve-duplicate-guard: cancelado como duplicado (${reason}).`,
    );

    await resolveOperationalErrorsForPost(params.supabase, params.ownerId, params.postId);

    return {
      ok: true as const,
      dryRun: false as const,
      applied: "cancel_as_duplicate" as const,
      postId: params.postId,
      cancelReason: reason,
      trace,
    };
  }

  return { ok: false as const, error: "unsupported_action" as const };
}
