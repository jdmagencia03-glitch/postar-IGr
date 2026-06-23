import { NextRequest, NextResponse } from "next/server";
import { getOwnerAccountById, getAccountAccessToken } from "@/lib/accounts";
import { getPlaybookForAccount, playbookHasContent, resolveNicheFromPlaybook } from "@/lib/ai/playbook";
import { getSessionUserId } from "@/lib/meta/oauth";
import { checkInstagramAccountHealth } from "@/lib/meta/instagram";
import { buildAccountOperationsSummary } from "@/lib/operations/account-ops";
import { computeCoverageDays } from "@/lib/operations/compute";
import { buildOperationsAlerts } from "@/lib/operations/alerts-engine";
import { getOwnerAccountRefs, getOwnerScheduledPosts } from "@/lib/posts";
import { getOwnerTikTokAccountById } from "@/lib/tiktok/accounts";
import { validateTikTokConnection } from "@/lib/tiktok/validate";
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
  let tiktokCreator: {
    username: string | null;
    nickname: string | null;
    max_video_post_duration_sec: number | null;
    last_validated_at: string | null;
    last_validation_error: string | null;
  } | null = null;

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
      if (tiktokAccount.status === "error") {
        tokenStatus = "expired";
        connectionMessage =
          tiktokAccount.last_validation_error ?? "Conta com erro — reconecte o TikTok";
      } else if (!tiktokAccount.token_expires_at) {
        tokenStatus = "unknown";
        connectionMessage = "Expiração do token não informada";
      } else {
        tokenStatus =
          new Date(tiktokAccount.token_expires_at).getTime() > Date.now() ? "valid" : "expired";
        connectionMessage =
          tokenStatus === "valid"
            ? "Token TikTok válido (renovação automática quando necessário)"
            : "Token TikTok expirado — será renovado na próxima publicação ou reconecte";
      }

      tiktokCreator = {
        username: tiktokAccount.creator_username ?? tiktokAccount.username,
        nickname: tiktokAccount.display_name,
        max_video_post_duration_sec: tiktokAccount.creator_max_duration_sec ?? null,
        last_validated_at: tiktokAccount.last_validated_at ?? null,
        last_validation_error: tiktokAccount.last_validation_error ?? null,
      };

      try {
        const live = await validateTikTokConnection(supabase, ownerId, id, { persist: false });
        if (live.creator) {
          tiktokCreator = {
            username: live.creator.username,
            nickname: live.creator.nickname,
            max_video_post_duration_sec: live.creator.max_video_post_duration_sec,
            last_validated_at: tiktokAccount.last_validated_at ?? live.checkedAt,
            last_validation_error: live.overall === "error" ? live.summary : null,
          };
          if (live.overall === "ok") tokenStatus = "valid";
        }
      } catch {
        // Mantém dados locais se API live falhar
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

  const recentPostIds = posts
    .slice()
    .sort((a, b) => new Date(b.scheduled_at).getTime() - new Date(a.scheduled_at).getTime())
    .slice(0, 60)
    .map((post) => post.id);

  const { data: recentLogs } = recentPostIds.length
    ? await supabase
        .from("publish_logs")
        .select("level, message, created_at")
        .in("post_id", recentPostIds)
        .order("created_at", { ascending: false })
        .limit(10)
    : { data: [] };

  const alerts = buildOperationsAlerts({
    accounts: [summary],
    posts,
    coverageDays: computeCoverageDays(posts),
    cronConfigured: Boolean(process.env.CRON_SECRET?.trim()),
    lastPublishAt: summary.lastPublication,
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
      tiktokCreator,
      recentLogs: recentLogs ?? [],
    },
    alerts,
    posts: {
      pending: posts.filter(
        (p) => p.status === "pending" || p.status === "retrying" || p.status === "needs_media",
      ),
      failed: posts.filter((p) => p.status === "failed" || p.status === "failed_persistent"),
      processing: posts.filter((p) => p.status === "processing"),
      published: posts.filter((p) => p.status === "published").slice(0, 20),
    },
  });
}
