import type { TikTokPublishDiagnostics } from "@/lib/tiktok/publish-diagnostics";

export type TikTokUnpauseSafetyCheck = {
  safe: boolean;
  blockReason?: string;
  failedChecks: string[];
};

export function validateTikTokUnpauseSafety(
  diagnostics: TikTokPublishDiagnostics,
): TikTokUnpauseSafetyCheck {
  const failedChecks: string[] = [];

  if (!diagnostics.safeToUnpauseTikTok) {
    failedChecks.push("safeToUnpauseTikTok");
  }
  if (diagnostics.cronTikTokPrivacyLevel !== "SELF_ONLY") {
    failedChecks.push("cronTikTokPrivacyLevel_not_SELF_ONLY");
  }
  if (diagnostics.willAttemptPublicPost) {
    failedChecks.push("willAttemptPublicPost");
  }
  if (!diagnostics.cronCanPublishWhilePrivate) {
    failedChecks.push("cronCanPublishWhilePrivate");
  }
  if (diagnostics.uploadMethod !== "FILE_UPLOAD") {
    failedChecks.push("uploadMethod_not_FILE_UPLOAD");
  }
  if (!diagnostics.tokenValid) {
    failedChecks.push("tokenValid");
  }

  if (failedChecks.length === 0) {
    return { safe: true, failedChecks };
  }

  const blockReason =
    diagnostics.blockReason ??
    failedChecks[0] ??
    "unsafe_to_unpause_tiktok";

  return {
    safe: false,
    blockReason,
    failedChecks,
  };
}

export function accountHandleFromDiagnostics(diagnostics: TikTokPublishDiagnostics) {
  return diagnostics.account;
}
