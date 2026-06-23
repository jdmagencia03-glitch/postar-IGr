import type { SocialPlatform } from "@/lib/types";

export function accountDiagnosticsPath(accountId: string, platform: SocialPlatform = "instagram") {
  return `/dashboard/accounts/${accountId}/diagnostics?platform=${platform}`;
}

export function accountReportsPath(
  accountId: string,
  platform: SocialPlatform = "instagram",
  extra?: Record<string, string | undefined>,
) {
  const query = new URLSearchParams({ account: accountId, platform });
  if (extra) {
    for (const [key, value] of Object.entries(extra)) {
      if (value) query.set(key, value);
    }
  }
  return `/dashboard/reports?${query.toString()}`;
}

export function accountErrorsPath(accountId: string, platform: SocialPlatform = "instagram") {
  return `/dashboard/errors?account=${accountId}&platform=${platform}`;
}
