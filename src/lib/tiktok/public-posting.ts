import { isTikTokUnauditedClientError } from "@/lib/tiktok/creator";
import type { TikTokUploadMethod } from "@/lib/tiktok/upload-config";

export type PublicPostBlockReason =
  | "token_invalid"
  | "missing_scope"
  | "upload_method_not_file_upload"
  | "public_to_everyone_not_in_creator_privacy_options"
  | "creator_account_private"
  | "public_posting_not_enabled"
  | "direct_post_audit_not_approved"
  | "unaudited_client_can_only_post_to_private_accounts";

export const UNAUDITED_CLIENT_ERROR_CODE = "unaudited_client_can_only_post_to_private_accounts";

export function isTikTokPublicPostingEnabled() {
  return process.env.TIKTOK_PUBLIC_POSTING_ENABLED === "true";
}

export function isTikTokDirectPostAuditApproved() {
  return process.env.TIKTOK_DIRECT_POST_AUDIT_APPROVED === "true";
}

export function hasPublicToEveryoneOption(privacyLevelOptions?: string[]) {
  return (privacyLevelOptions ?? []).includes("PUBLIC_TO_EVERYONE");
}

export function extractLastTikTokPublicPostError(lastTikTokError: string | null | undefined) {
  if (!lastTikTokError) return null;
  if (isTikTokUnauditedClientError(lastTikTokError)) {
    return UNAUDITED_CLIENT_ERROR_CODE;
  }
  return null;
}

export function inferAccountAppearsPrivate(privacyLevelOptions: string[]) {
  if (hasPublicToEveryoneOption(privacyLevelOptions)) {
    return false;
  }
  return (
    privacyLevelOptions.includes("SELF_ONLY") ||
    privacyLevelOptions.includes("MUTUAL_FOLLOW_FRIENDS") ||
    privacyLevelOptions.length === 0
  );
}

export function canUseTikTokPublicDirectPost(params: {
  privacyLevelOptions: string[];
  publicPostingEnabled?: boolean;
  directPostAuditApproved?: boolean;
  lastTikTokError?: string | null;
}) {
  const publicPostingEnabled = params.publicPostingEnabled ?? isTikTokPublicPostingEnabled();
  const directPostAuditApproved =
    params.directPostAuditApproved ?? isTikTokDirectPostAuditApproved();
  const lastPublicError = extractLastTikTokPublicPostError(params.lastTikTokError ?? null);

  if (!publicPostingEnabled) return false;
  if (!directPostAuditApproved) return false;
  if (!hasPublicToEveryoneOption(params.privacyLevelOptions)) return false;
  if (lastPublicError) return false;
  return true;
}

export function evaluatePublicPostEligibility(params: {
  tokenValid: boolean;
  scopesOk: boolean;
  uploadMethod: TikTokUploadMethod;
  privacyLevelOptions: string[];
  lastTikTokError?: string | null;
  publicPostingEnabled?: boolean;
  directPostAuditApproved?: boolean;
}) {
  const privacyLevelOptions = params.privacyLevelOptions;
  const hasPublicToEveryone = hasPublicToEveryoneOption(privacyLevelOptions);
  const accountAppearsPrivate = inferAccountAppearsPrivate(privacyLevelOptions);
  const publicPostingEnabled = params.publicPostingEnabled ?? isTikTokPublicPostingEnabled();
  const directPostAuditApproved =
    params.directPostAuditApproved ?? isTikTokDirectPostAuditApproved();
  const lastTikTokPublicPostError = extractLastTikTokPublicPostError(params.lastTikTokError ?? null);

  if (!params.tokenValid) {
    return {
      hasPublicToEveryone,
      canPublicPostNow: false,
      accountAppearsPrivate,
      publicPostBlockReason: "token_invalid" as const,
      lastTikTokPublicPostError,
      publicPostingEnabled,
      directPostAuditApproved,
    };
  }

  if (!params.scopesOk) {
    return {
      hasPublicToEveryone,
      canPublicPostNow: false,
      accountAppearsPrivate,
      publicPostBlockReason: "missing_scope" as const,
      lastTikTokPublicPostError,
      publicPostingEnabled,
      directPostAuditApproved,
    };
  }

  if (params.uploadMethod !== "FILE_UPLOAD") {
    return {
      hasPublicToEveryone,
      canPublicPostNow: false,
      accountAppearsPrivate,
      publicPostBlockReason: "upload_method_not_file_upload" as const,
      lastTikTokPublicPostError,
      publicPostingEnabled,
      directPostAuditApproved,
    };
  }

  if (!hasPublicToEveryone) {
    return {
      hasPublicToEveryone: false,
      canPublicPostNow: false,
      accountAppearsPrivate,
      publicPostBlockReason: (accountAppearsPrivate
        ? "creator_account_private"
        : "public_to_everyone_not_in_creator_privacy_options") as PublicPostBlockReason,
      lastTikTokPublicPostError,
      publicPostingEnabled,
      directPostAuditApproved,
    };
  }

  if (!publicPostingEnabled) {
    return {
      hasPublicToEveryone: true,
      canPublicPostNow: false,
      accountAppearsPrivate: false,
      publicPostBlockReason: "public_posting_not_enabled" as const,
      lastTikTokPublicPostError,
      publicPostingEnabled,
      directPostAuditApproved,
    };
  }

  if (!directPostAuditApproved) {
    return {
      hasPublicToEveryone: true,
      canPublicPostNow: false,
      accountAppearsPrivate: false,
      publicPostBlockReason: "direct_post_audit_not_approved" as const,
      lastTikTokPublicPostError,
      publicPostingEnabled,
      directPostAuditApproved,
    };
  }

  if (lastTikTokPublicPostError) {
    return {
      hasPublicToEveryone: true,
      canPublicPostNow: false,
      accountAppearsPrivate: false,
      publicPostBlockReason: "unaudited_client_can_only_post_to_private_accounts" as const,
      lastTikTokPublicPostError,
      publicPostingEnabled,
      directPostAuditApproved,
    };
  }

  return {
    hasPublicToEveryone: true,
    canPublicPostNow: true,
    accountAppearsPrivate: false,
    publicPostBlockReason: null,
    lastTikTokPublicPostError: null,
    publicPostingEnabled,
    directPostAuditApproved,
  };
}

export function getCronPublicPostBlockLogReason(params: {
  privacyLevelOptions: string[];
  lastTikTokError?: string | null;
}) {
  if (!isTikTokPublicPostingEnabled()) return null;
  if (!hasPublicToEveryoneOption(params.privacyLevelOptions)) return null;
  if (!isTikTokDirectPostAuditApproved()) {
    return "public_blocked_direct_post_audit_not_approved";
  }
  if (extractLastTikTokPublicPostError(params.lastTikTokError ?? null)) {
    return "public_blocked_unaudited_client_error";
  }
  return null;
}

export function wouldUsePublicPrivacyLevel(params: {
  privacyLevelOptions: string[];
  lastTikTokError?: string | null;
  publicPostingEnabled?: boolean;
  directPostAuditApproved?: boolean;
}) {
  if (
    canUseTikTokPublicDirectPost({
      privacyLevelOptions: params.privacyLevelOptions,
      lastTikTokError: params.lastTikTokError,
      publicPostingEnabled: params.publicPostingEnabled,
      directPostAuditApproved: params.directPostAuditApproved,
    })
  ) {
    return "PUBLIC_TO_EVERYONE" as const;
  }
  return "SELF_ONLY" as const;
}
