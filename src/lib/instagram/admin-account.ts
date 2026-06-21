import type { SupabaseClient } from "@supabase/supabase-js";
import { getPlaybookForAccount, playbookHasContent } from "@/lib/ai/playbook";
import { getAccountAccessToken } from "@/lib/accounts";
import { accountHandle, getInstagramAccountForAdmin } from "@/lib/instagram/admin-gate";
import {
  checkInstagramAccountHealth,
  getInstagramAccountStats,
} from "@/lib/meta/instagram";
import { validateAccountPermissions } from "@/lib/operations/validate-permissions";

function isFailedStatus(status: string) {
  return status === "failed" || status === "failed_persistent";
}

export async function buildInstagramAccountDiagnostics(params: {
  supabase: SupabaseClient;
  ownerId: string;
  accountId: string;
}) {
  const account = await getInstagramAccountForAdmin(
    params.supabase,
    params.ownerId,
    params.accountId,
  );

  if (!account) {
    return { ok: false as const, error: "account_not_found" as const };
  }

  const accessToken = getAccountAccessToken(account);
  const provider = account.auth_provider === "facebook" ? "facebook" : "instagram";
  const permissions = await validateAccountPermissions(
    params.supabase,
    params.ownerId,
    params.accountId,
    "instagram",
  );

  let accountType: string | null = null;
  if (accessToken) {
    try {
      const stats = await getInstagramAccountStats(accessToken, {
        provider,
        igUserId: account.ig_user_id,
      });
      accountType = stats.account_type ?? null;
    } catch {
      // stats opcionais — token/permissions já cobrem o essencial
    }
  }

  const health = accessToken
    ? await checkInstagramAccountHealth(accessToken, {
        provider,
        igUserId: account.ig_user_id,
      })
    : { status: "error" as const, message: "Token ausente" };

  const { data: posts, error: postsError } = await params.supabase
    .from("scheduled_posts")
    .select("status, error_message, scheduled_at")
    .eq("account_id", params.accountId)
    .in("status", ["failed", "failed_persistent", "retrying"]);

  if (postsError) {
    throw new Error(postsError.message);
  }

  const failedPosts = (posts ?? []).filter((post) => isFailedStatus(post.status)).length;
  const retryingPosts = (posts ?? []).filter((post) => post.status === "retrying").length;
  const lastError =
    [...(posts ?? [])]
      .filter((post) => post.error_message)
      .sort(
        (a, b) => new Date(b.scheduled_at).getTime() - new Date(a.scheduled_at).getTime(),
      )[0]?.error_message ?? null;

  const playbook = await getPlaybookForAccount(params.ownerId, params.accountId);
  const playbookConfigured = playbookHasContent(playbook);

  const tokenValid = health.status === "active";
  const permissionsOk = permissions.overall !== "error";

  let recommendation =
    "Conta operacional. Revise posts falhados individualmente antes de retomar publicação automática.";
  if (account.publishing_paused && failedPosts + retryingPosts > 0) {
    recommendation =
      "Conta pausada. Use failed-post-debug para inspecionar URLs de vídeo e erros brutos do container Instagram antes de retry manual de 1 post.";
  } else if (!account.publishing_paused && failedPosts + retryingPosts > 0) {
    recommendation =
      "Pause a conta primeiro (pause-account confirm:true). Depois rode failed-post-debug e só então retry-one-post com confirm:true para 1 post.";
  } else if (!tokenValid) {
    recommendation = "Reconecte a conta Instagram — token inválido ou expirado.";
  } else if (lastError?.includes("Processamento da mídia falhou")) {
    recommendation =
      "Erros de processamento de mídia: valide se videoUrl é MP4 público (200, video/mp4, >0 bytes) e se o Instagram consegue baixar o arquivo.";
  }

  return {
    ok: true as const,
    account: accountHandle(account.ig_username, account.id),
    ownerId: params.ownerId,
    accountId: params.accountId,
    tokenValid,
    permissionsOk,
    igUserId: account.ig_user_id,
    pageId: account.page_id,
    accountType,
    publishingPaused: Boolean(account.publishing_paused),
    failedPosts,
    retryingPosts,
    lastError,
    playbookConfigured,
    recommendation,
    permissions,
  };
}

export async function setInstagramAccountPublishingPaused(params: {
  supabase: SupabaseClient;
  ownerId: string;
  accountId: string;
  publishingPaused: boolean;
  pauseReason?: string | null;
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
  const publishPausedBefore = Boolean(account.publishing_paused);
  const desiredPaused = params.publishingPaused;

  if (!params.confirm) {
    const willChange = desiredPaused !== publishPausedBefore;
    return {
      ok: true as const,
      dryRun: true as const,
      wouldChange: willChange,
      desiredPaused,
      alreadyInDesiredState: !willChange,
      account: handle,
      ownerId: params.ownerId,
      accountId: params.accountId,
      publishPausedBefore,
      publishPausedAfter: desiredPaused,
      message: willChange
        ? desiredPaused
          ? "Dry-run: confirm:true pausaria publicação automática desta conta."
          : "Dry-run: confirm:true reativaria publicação automática desta conta."
        : desiredPaused
          ? "Conta já está pausada — nenhuma alteração necessária."
          : "Conta já está ativa — nenhuma alteração necessária.",
    };
  }

  if (desiredPaused === publishPausedBefore) {
    return {
      ok: true as const,
      paused: desiredPaused,
      alreadyInDesiredState: true as const,
      account: handle,
      ownerId: params.ownerId,
      accountId: params.accountId,
      publishPausedBefore,
      publishPausedAfter: publishPausedBefore,
      message: desiredPaused ? "Conta já estava pausada." : "Conta já estava ativa.",
    };
  }

  const now = new Date().toISOString();
  const updatePayload = desiredPaused
    ? {
        publishing_paused: true,
        pause_reason: params.pauseReason ?? account.pause_reason ?? "manual_admin_pause",
        updated_at: now,
      }
    : {
        publishing_paused: false,
        pause_reason: null,
        cooldown_until: null,
        updated_at: now,
      };

  const { data: updated, error: updateError } = await params.supabase
    .from("instagram_accounts")
    .update(updatePayload)
    .eq("id", params.accountId)
    .or(`owner_id.eq.${params.ownerId},user_id.eq.${params.ownerId}`)
    .select("id, publishing_paused")
    .maybeSingle();

  if (updateError || !updated) {
    return {
      ok: false as const,
      error: "update_failed" as const,
      message: updateError?.message ?? "Falha ao atualizar estado de publicação da conta",
    };
  }

  console.info(
    "[instagram-account-publishing-state]",
    JSON.stringify({
      ownerId: params.ownerId,
      accountId: params.accountId,
      account: handle,
      publishingPaused: desiredPaused,
    }),
  );

  return {
    ok: true as const,
    paused: desiredPaused,
    account: handle,
    ownerId: params.ownerId,
    accountId: params.accountId,
    publishPausedBefore,
    publishPausedAfter: Boolean(updated.publishing_paused),
    message: desiredPaused
      ? "Publicação automática pausada para esta conta. Posts e scheduled_at não foram alterados."
      : "Publicação automática reativada para esta conta.",
  };
}

/** @deprecated Use setInstagramAccountPublishingPaused — mantido por compatibilidade. */
export async function pauseInstagramAccount(params: {
  supabase: SupabaseClient;
  ownerId: string;
  accountId: string;
  confirm: boolean;
  publishingPaused?: boolean;
  pauseReason?: string | null;
}) {
  return setInstagramAccountPublishingPaused({
    ...params,
    publishingPaused: params.publishingPaused ?? true,
  });
}
