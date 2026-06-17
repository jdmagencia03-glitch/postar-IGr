import { redirect } from "next/navigation";
import { AccountFilterBar } from "@/components/AccountFilterBar";
import { formatDateTime } from "@/lib/utils";
import { getSessionUserId } from "@/lib/meta/oauth";
import { getOwnerAccountRefs, getOwnerScheduledPosts } from "@/lib/posts";
import { createAdminClient } from "@/lib/supabase/admin";
import type { SocialPlatform } from "@/lib/types";

export const dynamic = "force-dynamic";

function isPlatformFilter(value: string | undefined): value is SocialPlatform | "all" {
  return value === "instagram" || value === "tiktok" || value === "all" || value === undefined;
}

export default async function LogsPage({
  searchParams,
}: {
  searchParams: Promise<{ account?: string; platform?: string }>;
}) {
  const ownerId = await getSessionUserId();
  if (!ownerId) redirect("/login?next=/dashboard/logs");

  const params = await searchParams;
  const platformFilter: SocialPlatform | "all" = isPlatformFilter(params.platform)
    ? params.platform ?? "all"
    : "all";

  const supabase = createAdminClient();
  const accountRefs = await getOwnerAccountRefs(supabase, ownerId);
  const visibleRefs = accountRefs.filter(
    (account) => platformFilter === "all" || account.platform === platformFilter,
  );
  const selectedAccountId =
    params.account && visibleRefs.some((account) => account.id === params.account)
      ? params.account
      : undefined;

  const posts = await getOwnerScheduledPosts(supabase, ownerId, {
    platform: platformFilter,
    accountId: selectedAccountId,
  });
  const postIds = posts.map((post) => post.id);

  const { data: logs } = postIds.length
    ? await supabase
        .from("publish_logs")
        .select("*")
        .in("post_id", postIds)
        .order("created_at", { ascending: false })
        .limit(200)
    : { data: [] };

  const levelColors = {
    info: "text-ig-link",
    success: "text-ig-text",
    error: "text-ig-danger",
  };

  return (
    <div className="mx-auto max-w-4xl">
      <header className="ig-page-header">
        <h1>Logs de publicação</h1>
        <p>Histórico de tentativas e resultados — Instagram e TikTok.</p>
      </header>

      <AccountFilterBar
          accounts={accountRefs}
          selectedAccountId={selectedAccountId}
          selectedPlatform={platformFilter}
          basePath="/dashboard/logs"
        />

        <div className="ig-panel divide-y divide-ig-border overflow-hidden">
          {logs?.map((log) => (
            <div key={log.id} className="px-4 py-3">
              <div className="mb-1 flex items-center justify-between">
                <span
                  className={`text-xs font-medium uppercase ${levelColors[log.level as keyof typeof levelColors]}`}
                >
                  {log.level}
                </span>
                <span className="text-xs text-ig-muted">
                  {formatDateTime(log.created_at)}
                </span>
              </div>
              <p className="text-sm text-ig-text">{log.message}</p>
            </div>
          ))}

          {!logs?.length && (
            <p className="px-4 py-12 text-center text-ig-muted">Nenhum log ainda.</p>
          )}
        </div>
    </div>
  );
}
