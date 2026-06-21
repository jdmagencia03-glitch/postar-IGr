import { pickTestPrivacyLevel } from "@/lib/tiktok/creator";
import {
  canUseTikTokPublicDirectPost,
  getCronPublicPostBlockLogReason,
  hasPublicToEveryoneOption,
  isTikTokDirectPostAuditApproved,
  isTikTokPublicPostingEnabled,
} from "@/lib/tiktok/public-posting";
import type { TikTokClientAuditStatus } from "@/lib/tiktok/publish-diagnostics";
import type { TikTokUploadMethod } from "@/lib/tiktok/upload-config";

export type TikTokPublishMode = "cron" | "admin_test";

export function isTikTokClientAudited() {
  return process.env.TIKTOK_CLIENT_AUDITED === "true";
}

export function getTikTokClientAuditStatus(): TikTokClientAuditStatus {
  return isTikTokClientAudited() ? "audited" : "unknown_or_unaudited";
}

/**
 * Cron: PUBLIC_TO_EVERYONE só com env + auditoria Direct Post aprovada + creator_info.
 */
export function resolveCronTikTokPrivacyLevel(
  options?: string[],
  lastTikTokError?: string | null,
) {
  if (
    canUseTikTokPublicDirectPost({
      privacyLevelOptions: options ?? [],
      lastTikTokError,
    })
  ) {
    return "PUBLIC_TO_EVERYONE";
  }
  return pickTestPrivacyLevel(options);
}

export function resolveTikTokPublishPrivacyLevel(params: {
  options?: string[];
  requested?: string | null;
  publishMode?: TikTokPublishMode;
  testMode?: boolean;
  lastTikTokError?: string | null;
}) {
  const options = params.options ?? [];

  if (params.requested === "PUBLIC_TO_EVERYONE") {
    if (!hasPublicToEveryoneOption(options)) {
      if (params.publishMode === "cron") {
        return pickTestPrivacyLevel(options);
      }
      throw new Error(
        "PUBLIC_TO_EVERYONE indisponível — não consta em privacy_level_options do creator_info.",
      );
    }
    if (
      !canUseTikTokPublicDirectPost({
        privacyLevelOptions: options,
        lastTikTokError: params.lastTikTokError,
      })
    ) {
      if (params.publishMode === "cron") {
        return pickTestPrivacyLevel(options);
      }
      throw new Error(
        "PUBLIC_TO_EVERYONE bloqueado — Direct Post audit não aprovado (TIKTOK_DIRECT_POST_AUDIT_APPROVED).",
      );
    }
    return "PUBLIC_TO_EVERYONE";
  }

  if (params.publishMode === "cron") {
    return resolveCronTikTokPrivacyLevel(options, params.lastTikTokError);
  }

  if (params.testMode || params.publishMode === "admin_test") {
    return pickTestPrivacyLevel(options);
  }

  return resolveCronTikTokPrivacyLevel(options, params.lastTikTokError);
}

export function willAttemptPublicTikTokPost(privacyLevel: string) {
  return privacyLevel === "PUBLIC_TO_EVERYONE";
}

export function formatCronTikTokPublishLog(params: {
  uploadMethod: TikTokUploadMethod;
  privacyLevel: string;
  publishMode: TikTokPublishMode;
  privacyLevelOptions?: string[];
  lastTikTokError?: string | null;
}) {
  const publicBlockReason = getCronPublicPostBlockLogReason({
    privacyLevelOptions: params.privacyLevelOptions ?? [],
    lastTikTokError: params.lastTikTokError,
  });

  return {
    method: params.uploadMethod,
    privacyLevel: params.privacyLevel,
    clientAuditStatus: getTikTokClientAuditStatus(),
    publicPostingEnabled: isTikTokPublicPostingEnabled(),
    directPostAuditApproved: isTikTokDirectPostAuditApproved(),
    publishMode: params.publishMode,
    ...(publicBlockReason ? { publicBlockReason } : {}),
  };
}

export function buildCronUnpauseDiagnostics(params: {
  tokenValid: boolean;
  scopesOk: boolean;
  uploadMethod: TikTokUploadMethod;
  urlOwnershipRisk: boolean;
  privacyLevelOptions: string[];
  lastTikTokError?: string | null;
}) {
  const cronTikTokPrivacyLevel = resolveCronTikTokPrivacyLevel(
    params.privacyLevelOptions,
    params.lastTikTokError,
  );
  const willAttemptPublicPost = willAttemptPublicTikTokPost(cronTikTokPrivacyLevel);
  const cronCanPublishWhilePrivate =
    params.tokenValid &&
    params.scopesOk &&
    params.uploadMethod === "FILE_UPLOAD" &&
    !params.urlOwnershipRisk;

  const safeToUnpauseTikTok =
    cronCanPublishWhilePrivate && !willAttemptPublicPost && cronTikTokPrivacyLevel === "SELF_ONLY";

  let blockReason: string | undefined;
  if (!safeToUnpauseTikTok) {
    if (willAttemptPublicPost) {
      blockReason = "cron_would_attempt_public_post";
    } else if (cronTikTokPrivacyLevel !== "SELF_ONLY") {
      blockReason = "cron_privacy_not_self_only";
    } else if (!cronCanPublishWhilePrivate) {
      blockReason = "cron_not_ready_for_private_publish";
    }
  }

  return {
    cronTikTokPrivacyLevel,
    cronCanPublishWhilePrivate,
    willAttemptPublicPost,
    safeToUnpauseTikTok,
    blockReason,
  };
}
