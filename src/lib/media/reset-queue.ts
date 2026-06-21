import type { SupabaseClient } from "@supabase/supabase-js";
import { getInstagramAccountForAdmin, accountHandle } from "@/lib/instagram/admin-gate";

export type QueueResetBackupRow = {
  post_id: string;
  caption: string | null;
  scheduled_at: string;
  status: string;
  video_url: string | null;
  error_message: string | null;
  retry_count: number | null;
};

const UNPUBLISHED_STATUSES = [
  "pending",
  "processing",
  "retrying",
  "failed",
  "failed_persistent",
  "needs_media",
] as const;

export async function buildInstagramQueueResetPlan(params: {
  supabase: SupabaseClient;
  ownerId: string;
  accountId: string;
  mode: "cancel_all_unpublished";
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

  const handle = accountHandle(account.ig_username, account.id);

  const { data: unpublished, error: unpublishedError } = await params.supabase
    .from("scheduled_posts")
    .select(
      "id, caption, scheduled_at, status, media_urls, error_message, retry_count",
    )
    .eq("account_id", params.accountId)
    .in("status", [...UNPUBLISHED_STATUSES]);

  if (unpublishedError) {
    throw new Error(unpublishedError.message);
  }

  const { count: publishedCount } = await params.supabase
    .from("scheduled_posts")
    .select("id", { count: "exact", head: true })
    .eq("account_id", params.accountId)
    .eq("status", "published");

  const backup: QueueResetBackupRow[] = (unpublished ?? []).map((post) => ({
    post_id: post.id,
    caption: post.caption,
    scheduled_at: post.scheduled_at,
    status: post.status,
    video_url: post.media_urls?.[0] ?? null,
    error_message: post.error_message,
    retry_count: post.retry_count ?? null,
  }));

  if (!params.confirm) {
    return {
      ok: true as const,
      dryRun: true as const,
      account: handle,
      ownerId: params.ownerId,
      accountId: params.accountId,
      mode: params.mode,
      wouldCancel: backup.length,
      wouldKeepPublished: publishedCount ?? 0,
      backupAvailable: true,
      backup,
      message:
        "Dry-run: confirm:true marcará posts não publicados como cancelled (sem apagar logs nem registros).",
    };
  }

  const now = new Date().toISOString();
  const ids = backup.map((row) => row.post_id);

  if (ids.length) {
    const { error: updateError } = await params.supabase
      .from("scheduled_posts")
      .update({
        status: "cancelled",
        cancel_reason: "queue_reset_by_admin",
        updated_at: now,
      })
      .in("id", ids)
      .in("status", [...UNPUBLISHED_STATUSES]);

    if (updateError) {
      return {
        ok: false as const,
        error: "cancel_failed" as const,
        message: updateError.message,
        backup,
      };
    }
  }

  console.info(
    "[instagram-queue-reset]",
    JSON.stringify({
      ownerId: params.ownerId,
      accountId: params.accountId,
      cancelled: ids.length,
    }),
  );

  return {
    ok: true as const,
    dryRun: false as const,
    account: handle,
    ownerId: params.ownerId,
    accountId: params.accountId,
    cancelled: ids.length,
    wouldKeepPublished: publishedCount ?? 0,
    backupAvailable: true,
    backup,
    message: `${ids.length} post(s) marcados como cancelled. Logs e registros preservados.`,
  };
}
