import { NextRequest, NextResponse } from "next/server";
import { getOwnerAccountById, getAccountAccessToken } from "@/lib/accounts";
import { getPlaybookForAccount, playbookHasContent, resolveNicheFromPlaybook } from "@/lib/ai/playbook";
import { getSessionUserId } from "@/lib/meta/oauth";
import { checkInstagramAccountHealth } from "@/lib/meta/instagram";
import { buildAccountOperationsSummary } from "@/lib/operations/account-ops";
import { buildOperationsAlerts } from "@/lib/operations/alerts-engine";
import { getOwnerAccountRefs, getOwnerScheduledPosts } from "@/lib/posts";
import { getOwnerTikTokAccountById } from "@/lib/tiktok/accounts";
import { createAdminClient } from "@/lib/supabase/admin";
import type { SocialPlatform } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ownerId = await getSessionUserId();
  if (!ownerId) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const { id } = await params;
  const platform = (request.nextUrl.searchParams.get("platform") ?? "instagram") as SocialPlatform;
  const supabase = createAdminClient();
  const refs = await getOwnerAccountRefs(supabase, ownerId);
  const ref = refs.find((account) => account.id === id && account.platform === platform);

  if (!ref) {
    return NextResponse.json({ error: "Conta não encontrada" }, { status: 404 });
  }

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
    } else {
      tokenStatus = "expired";
      connectionMessage = "Token indisponível";
    }
  } else {
    tiktokAccount = await getOwnerTikTokAccountById(supabase, ownerId, id);
    if (tiktokAccount) {
      permissions = tiktokAccount.scopes?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];
      if (!tiktokAccount.token_expires_at) {
        tokenStatus = "unknown";
        connectionMessage = "Expiração do token não informada";
      } else {
        tokenStatus =
          new Date(tiktokAccount.token_expires_at).getTime() > Date.now() ? "valid" : "expired";
        connectionMessage =
          tokenStatus === "valid" ? "Token TikTok válido" : "Token TikTok expirado — reconecte";
      }
    }
  }

  const summary = await buildAccountOperationsSummary({
    ref,
    igAccount,
    tiktokAccount,
    posts,
    ownerId,
    tokenStatus,
  });

  const playbook = await getPlaybookForAccount(ownerId, id);
  const niche = resolveNicheFromPlaybook(playbook, undefined);

  const { data: recentLogs } = await supabase
    .from("publish_logs")
    .select("level, message, created_at")
    .in(
      "post_id",
      posts.map((post) => post.id),
    )
    .order("created_at", { ascending: false })
    .limit(10);

  const alerts = buildOperationsAlerts({
    accounts: [summary],
    posts,
    coverageDays: 0,
    cronConfigured: Boolean(process.env.CRON_SECRET?.trim()),
    lastPublishAt: null,
    activeUploadBatchId: null,
  });

  return NextResponse.json({
    account: summary,
    diagnostics: {
      connectionStatus: tokenStatus,
      connectionMessage,
      permissions,
      playbookConfigured: playbookHasContent(playbook),
      niche,
      recentLogs: recentLogs ?? [],
    },
    alerts,
    posts: {
      pending: posts.filter((p) => p.status === "pending" || p.status === "retrying"),
      failed: posts.filter((p) => p.status === "failed" || p.status === "failed_persistent"),
      processing: posts.filter((p) => p.status === "processing"),
      published: posts.filter((p) => p.status === "published").slice(0, 20),
    },
  });
}
