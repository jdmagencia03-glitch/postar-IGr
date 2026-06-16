import type { OwnerAccountRef } from "@/lib/posts";
import type { SocialPlatform } from "@/lib/types";
import { cn } from "@/lib/utils";

interface Props {
  accounts: OwnerAccountRef[];
  selectedAccountId?: string;
  selectedPlatform?: SocialPlatform | "all";
  basePath: string;
  extraParams?: Record<string, string | undefined>;
  showPlatformTabs?: boolean;
}

function buildHref(
  basePath: string,
  params: Record<string, string | undefined>,
) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value && value !== "all") query.set(key, value);
  }
  const qs = query.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}

export function AccountFilterBar({
  accounts,
  selectedAccountId,
  selectedPlatform = "all",
  basePath,
  extraParams = {},
  showPlatformTabs = true,
}: Props) {
  if (!accounts.length) return null;

  const platformTabs: Array<{ id: SocialPlatform | "all"; label: string }> = [
    { id: "all", label: "Todas" },
    { id: "instagram", label: "Instagram" },
    { id: "tiktok", label: "TikTok" },
  ];

  const visibleAccounts = accounts.filter((account) => {
    if (selectedPlatform === "all") return true;
    return account.platform === selectedPlatform;
  });

  return (
    <div className="mb-6 space-y-3">
      {showPlatformTabs && (
        <div className="flex flex-wrap gap-2">
          {platformTabs.map((tab) => (
            <a
              key={tab.id}
              href={buildHref(basePath, {
                ...extraParams,
                platform: tab.id === "all" ? undefined : tab.id,
              })}
              className={cn(
                "rounded-full px-4 py-2 text-sm transition",
                selectedPlatform === tab.id
                  ? "bg-ig-primary text-ig-on-primary"
                  : "border border-ig-border bg-ig-elevated text-ig-text hover:bg-ig-secondary",
              )}
            >
              {tab.label}
            </a>
          ))}
        </div>
      )}

      {visibleAccounts.length > 1 && (
        <div className="flex flex-wrap gap-2">
          <a
            href={buildHref(basePath, {
              ...extraParams,
              platform: selectedPlatform === "all" ? undefined : selectedPlatform,
            })}
            className={cn(
              "rounded-full px-4 py-2 text-sm transition",
              !selectedAccountId
                ? "bg-ig-primary text-ig-on-primary"
                : "border border-ig-border bg-ig-elevated text-ig-text hover:bg-ig-secondary",
            )}
          >
            Todas as contas
          </a>
          {visibleAccounts.map((account) => (
            <a
              key={account.id}
              href={buildHref(basePath, {
                ...extraParams,
                platform: account.platform,
                account: account.id,
              })}
              className={cn(
                "rounded-full px-4 py-2 text-sm transition",
                selectedAccountId === account.id
                  ? "bg-ig-primary text-ig-on-primary"
                  : "border border-ig-border bg-ig-elevated text-ig-text hover:bg-ig-secondary",
              )}
            >
              {account.platform === "tiktok" ? "TT" : "IG"} @{account.username ?? "conta"}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
