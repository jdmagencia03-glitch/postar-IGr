import type { SupabaseClient } from "@supabase/supabase-js";
import { getValidTikTokAccessToken } from "@/lib/tiktok/accounts";
import { buildCronUnpauseDiagnostics, isTikTokClientAudited } from "@/lib/tiktok/cron-privacy";
import {
  formatCreatorInfoLog,
  hasRequiredPublishScopes,
  isTikTokUnauditedClientError,
  queryCreatorInfo,
  type TikTokCreatorInfoLog,
} from "@/lib/tiktok/creator";
import {
  evaluatePublicPostEligibility,
  isTikTokDirectPostAuditApproved,
  isTikTokPublicPostingEnabled,
  type PublicPostBlockReason,
} from "@/lib/tiktok/public-posting";
import {
  isUrlOwnershipRiskForPull,
  resolveTikTokUploadMethod,
  videoUrlHost,
  type TikTokUploadMethod,
} from "@/lib/tiktok/upload-config";
import type { TikTokAccount } from "@/lib/types";

export type TikTokClientAuditStatus = "unknown_or_unaudited" | "audited";

export type TikTokPublishDiagnostics = {
  platform: "tiktok";
  account: string;
  accountId: string;
  publishPaused: boolean;
  tokenValid: boolean;
  uploadMethod: TikTokUploadMethod;
  configuredUploadMethod: TikTokUploadMethod;
  videoUrlHost: string | null;
  sampleVideoUrl: string | null;
  urlOwnershipRisk: boolean;
  lastTikTokError: string | null;
  scopesOk: boolean;
  creatorUsername: string | null;
  creatorInfo: TikTokCreatorInfoLog | null;
  clientAuditStatus: TikTokClientAuditStatus;
  privacyLevelOptions: string[];
  hasPublicToEveryone: boolean;
  accountAppearsPrivate: boolean;
  publicPostBlockReason: PublicPostBlockReason | null;
  publicPostingEnabled: boolean;
  directPostAuditApproved: boolean;
  lastTikTokPublicPostError: string | null;
  recommendedPrivacyLevelForTest: "SELF_ONLY";
  canPublicPostNow: boolean;
  requiresTikTokAuditForPublicPosting: boolean;
  cronTikTokPrivacyLevel: string;
  cronCanPublishWhilePrivate: boolean;
  willAttemptPublicPost: boolean;
  safeToUnpauseTikTok: boolean;
  blockReason?: string;
  recommendation: string;
};

function accountHandle(account: TikTokAccount) {
  const u = account.username ?? account.display_name ?? account.id.slice(0, 8);
  return u.startsWith("@") ? u : `@${u}`;
}

async function resolveLastTikTokError(
  supabase: SupabaseClient,
  account: TikTokAccount,
) {
  const { data: failedPost } = await supabase
    .from("scheduled_posts")
    .select("error_message, updated_at")
    .eq("platform", "tiktok")
    .eq("tiktok_account_id", account.id)
    .in("status", ["failed", "failed_persistent", "retrying"])
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return failedPost?.error_message ?? account.last_validation_error ?? null;
}

export async function buildTikTokPublishDiagnostics(params: {
  supabase: SupabaseClient;
  account: TikTokAccount;
  sampleVideoUrl?: string | null;
}): Promise<TikTokPublishDiagnostics> {
  const { account, supabase } = params;

  let tokenValid = false;
  let creatorUsername: string | null = account.creator_username ?? account.username ?? null;
  let creatorInfo: TikTokCreatorInfoLog | null = null;
  let privacyLevelOptions: string[] = [];

  try {
    const accessToken = await getValidTikTokAccessToken(supabase, account);
    const creator = await queryCreatorInfo(accessToken);
    tokenValid = Boolean(creator);
    if (creator) {
      creatorInfo = formatCreatorInfoLog(creator);
      creatorUsername = creator.creator_username ?? creatorUsername;
      privacyLevelOptions = creator.privacy_level_options ?? [];
    }
  } catch {
    tokenValid = false;
  }

  const { data: failedPost } = await supabase
    .from("scheduled_posts")
    .select("media_urls, error_message, updated_at")
    .eq("platform", "tiktok")
    .eq("tiktok_account_id", account.id)
    .in("status", ["failed", "failed_persistent", "retrying"])
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const sampleVideoUrl =
    params.sampleVideoUrl ??
    (Array.isArray(failedPost?.media_urls) ? failedPost.media_urls[0] : null) ??
    null;

  const configuredUploadMethod = resolveTikTokUploadMethod(sampleVideoUrl);
  const uploadMethod = configuredUploadMethod;
  const host = videoUrlHost(sampleVideoUrl);
  const urlOwnershipRisk =
    configuredUploadMethod === "PULL_FROM_URL" && isUrlOwnershipRiskForPull(sampleVideoUrl);

  const lastTikTokError = await resolveLastTikTokError(supabase, account);
  const scopesOk = hasRequiredPublishScopes(account.scopes);
  const publicPostingEnabled = isTikTokPublicPostingEnabled();
  const directPostAuditApproved = isTikTokDirectPostAuditApproved();
  const clientAuditStatus: TikTokClientAuditStatus = isTikTokClientAudited()
    ? "audited"
    : "unknown_or_unaudited";

  const publicEligibility = evaluatePublicPostEligibility({
    tokenValid,
    scopesOk,
    uploadMethod,
    privacyLevelOptions,
    lastTikTokError,
    publicPostingEnabled,
    directPostAuditApproved,
  });

  const requiresTikTokAuditForPublicPosting =
    !publicEligibility.canPublicPostNow &&
    (publicEligibility.publicPostBlockReason === "direct_post_audit_not_approved" ||
      publicEligibility.publicPostBlockReason ===
        "unaudited_client_can_only_post_to_private_accounts" ||
      publicEligibility.publicPostBlockReason === "creator_account_private" ||
      publicEligibility.publicPostBlockReason ===
        "public_to_everyone_not_in_creator_privacy_options" ||
      Boolean(lastTikTokError && isTikTokUnauditedClientError(lastTikTokError)));

  let recommendation = "Pronto para testar publicação com FILE_UPLOAD (SELF_ONLY).";
  if (!scopesOk) {
    recommendation = "Reconecte a conta com scopes video.upload e video.publish.";
  } else if (!tokenValid) {
    recommendation = "Token inválido — reconecte ou valide em /api/tiktok/validate.";
  } else if (urlOwnershipRisk) {
    recommendation =
      "PULL_FROM_URL com Supabase Storage exige verificação de domínio. Use FILE_UPLOAD (padrão).";
  } else if (publicEligibility.canPublicPostNow) {
    recommendation =
      "Direct Post auditado e creator_info OK. Cron pode usar PUBLIC_TO_EVERYONE. Teste via /api/admin/tiktok/test-public-post.";
  } else if (publicEligibility.publicPostBlockReason === "direct_post_audit_not_approved") {
    recommendation =
      "PUBLIC_TO_EVERYONE aparece no creator_info, mas o app ainda não tem Direct Post auditado. Mantenha TIKTOK_DIRECT_POST_AUDIT_APPROVED=false e cron em SELF_ONLY até aprovação TikTok.";
  } else if (
    publicEligibility.publicPostBlockReason === "unaudited_client_can_only_post_to_private_accounts"
  ) {
    recommendation =
      "Tentativa pública recente falhou com app não auditado. Use SELF_ONLY até aprovação Direct Post no TikTok Developers.";
  } else if (publicEligibility.publicPostBlockReason === "creator_account_private") {
    recommendation =
      "Conta TikTok parece privada — PUBLIC_TO_EVERYONE não está em privacy_level_options.";
  } else if (account.publishing_paused) {
    recommendation = "Conta pausada. Valide publish-diagnostics antes de despausar.";
  }

  const cronUnpause = buildCronUnpauseDiagnostics({
    tokenValid,
    scopesOk,
    uploadMethod,
    urlOwnershipRisk,
    privacyLevelOptions,
    lastTikTokError,
  });

  if (cronUnpause.safeToUnpauseTikTok && account.publishing_paused) {
    recommendation =
      "Cron TikTok em SELF_ONLY. Seguro despausar para posts privados enquanto Direct Post não estiver auditado.";
  }

  return {
    platform: "tiktok",
    account: accountHandle(account),
    accountId: account.id,
    publishPaused: Boolean(account.publishing_paused),
    tokenValid,
    uploadMethod,
    configuredUploadMethod,
    videoUrlHost: host,
    sampleVideoUrl,
    urlOwnershipRisk,
    lastTikTokError,
    scopesOk,
    creatorUsername,
    creatorInfo,
    clientAuditStatus,
    privacyLevelOptions,
    hasPublicToEveryone: publicEligibility.hasPublicToEveryone,
    accountAppearsPrivate: publicEligibility.accountAppearsPrivate,
    publicPostBlockReason: publicEligibility.publicPostBlockReason,
    publicPostingEnabled,
    directPostAuditApproved,
    lastTikTokPublicPostError: publicEligibility.lastTikTokPublicPostError,
    recommendedPrivacyLevelForTest: "SELF_ONLY",
    canPublicPostNow: publicEligibility.canPublicPostNow,
    requiresTikTokAuditForPublicPosting,
    cronTikTokPrivacyLevel: cronUnpause.cronTikTokPrivacyLevel,
    cronCanPublishWhilePrivate: cronUnpause.cronCanPublishWhilePrivate,
    willAttemptPublicPost: cronUnpause.willAttemptPublicPost,
    safeToUnpauseTikTok: cronUnpause.safeToUnpauseTikTok,
    ...(cronUnpause.blockReason ? { blockReason: cronUnpause.blockReason } : {}),
    recommendation,
  };
}
