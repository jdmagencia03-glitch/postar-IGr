import { redirect } from "next/navigation";
import { AccountDiagnosticsView } from "@/components/operations/AccountDiagnosticsView";
import { getSessionUserId } from "@/lib/meta/oauth";
import type { SocialPlatform } from "@/lib/types";

export const dynamic = "force-dynamic";

async function loadDiagnostics(accountId: string, platform: SocialPlatform, cookie: string) {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const response = await fetch(
    `${base}/api/operations/accounts/${accountId}/diagnostics?platform=${platform}`,
    {
      headers: { cookie },
      cache: "no-store",
    },
  );

  if (!response.ok) return null;
  return response.json();
}

export default async function AccountDiagnosticsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ platform?: string }>;
}) {
  const ownerId = await getSessionUserId();
  if (!ownerId) redirect("/login");

  const { id } = await params;
  const query = await searchParams;
  const platform = query.platform === "tiktok" ? "tiktok" : "instagram";

  // Server component loads via internal API pattern — use direct lib in future refactor
  const { headers } = await import("next/headers");
  const cookie = (await headers()).get("cookie") ?? "";

  const { getOwnerAccountRefs } = await import("@/lib/posts");
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const { getOwnerAccountById } = await import("@/lib/accounts");
  const { getOwnerTikTokAccountById } = await import("@/lib/tiktok/accounts");
  const { getOwnerScheduledPosts } = await import("@/lib/posts");
  const { buildAccountOperationsSummary } = await import("@/lib/operations/account-ops");
  const { getPlaybookForAccount, playbookHasContent, resolveNicheFromPlaybook } = await import(
    "@/lib/ai/playbook"
  );
  const { buildOperationsAlerts } = await import("@/lib/operations/alerts-engine");
  const { computeCoverageDays } = await import("@/lib/operations/compute");
  const { checkInstagramAccountHealth } = await import("@/lib/meta/instagram");
  const { getAccountAccessToken } = await import("@/lib/accounts");

  const supabase = createAdminClient();
  const refs = await getOwnerAccountRefs(supabase, ownerId);
  const ref = refs.find((account) => account.id === id && account.platform === platform);
  if (!ref) redirect("/dashboard/reports");

  const posts = await getOwnerScheduledPosts(supabase, ownerId, {
    accountId: id,
    hiddenFromReport: false,
    limit: 500,
  });

  let tokenStatus: "valid" | "expired" | "unknown" = "unknown";
  let connectionMessage: string | null = null;
  let permissions: string[] = [];
  let igAccount = null;
  let tiktokAccount = null;

  if (platform === "instagram") {
    igAccount = await getOwnerAccountById(supabase, ownerId, id);
    const accessToken = igAccount ? getAccountAccessToken(igAccount) : null;
    if (accessToken) {
      const health = await checkInstagramAccountHealth(accessToken, {
        provider: igAccount!.auth_provider === "facebook" ? "facebook" : "instagram",
        igUserId: igAccount!.ig_user_id,
      });
      tokenStatus = health.status === "active" ? "valid" : "expired";
      connectionMessage = health.message;
    }
  } else {
    tiktokAccount = await getOwnerTikTokAccountById(supabase, ownerId, id);
    if (tiktokAccount) {
      permissions = tiktokAccount.scopes?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];
      tokenStatus =
        tiktokAccount.token_expires_at &&
        new Date(tiktokAccount.token_expires_at).getTime() > Date.now()
          ? "valid"
          : "expired";
      connectionMessage =
        tokenStatus === "valid" ? "Token TikTok válido" : "Token TikTok expirado";
    }
  }

  const account = await buildAccountOperationsSummary({
    ref,
    igAccount,
    tiktokAccount,
    posts,
    ownerId,
    tokenStatus,
  });

  const playbook = await getPlaybookForAccount(ownerId, id);
  const { data: recentLogs } = await supabase
    .from("publish_logs")
    .select("level, message, created_at")
    .in("post_id", posts.map((post) => post.id))
    .order("created_at", { ascending: false })
    .limit(10);

  const initial = {
    account,
    diagnostics: {
      connectionStatus: tokenStatus,
      connectionMessage,
      permissions,
      playbookConfigured: playbookHasContent(playbook),
      niche: resolveNicheFromPlaybook(playbook, undefined) || null,
      recentLogs: recentLogs ?? [],
    },
    alerts: buildOperationsAlerts({
      accounts: [account],
      posts,
      coverageDays: computeCoverageDays(posts),
      cronConfigured: Boolean(process.env.CRON_SECRET?.trim()),
      lastPublishAt: account.lastPublication,
      activeUploadBatchId: null,
    }),
    posts: {
      pending: posts.filter(
        (p) => p.status === "pending" || p.status === "retrying" || p.status === "needs_media",
      ),
      failed: posts.filter((p) => p.status === "failed" || p.status === "failed_persistent"),
      processing: posts.filter((p) => p.status === "processing"),
      published: posts.filter((p) => p.status === "published").slice(0, 20),
    },
  };

  return (
    <AccountDiagnosticsView accountId={id} platform={platform} initial={initial} />
  );
}
