import { redirect } from "next/navigation";
import { Upload, Calendar, Users } from "lucide-react";
import { AccountFilterBar } from "@/components/AccountFilterBar";
import { PostsManager } from "@/components/PostsManager";
import { TikTokAccountsSection } from "@/components/TikTokAccountsSection";
import { OAuthAlert } from "@/components/OAuthAlert";
import { getOwnerTikTokAccounts } from "@/lib/tiktok/accounts";
import { isTikTokOAuthConfigured } from "@/lib/tiktok/oauth";
import { getSessionUserId } from "@/lib/meta/oauth";
import { getOwnerAccountRefs, getOwnerScheduledPosts } from "@/lib/posts";
import { createAdminClient } from "@/lib/supabase/admin";
import type { SocialPlatform } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function TikTokDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; connected?: string; platform?: string; account?: string }>;
}) {
  const ownerId = await getSessionUserId();
  if (!ownerId) redirect("/login?next=/dashboard/tiktok");

  const params = await searchParams;
  const supabase = createAdminClient();
  const accounts = await getOwnerTikTokAccounts(supabase, ownerId);
  const accountRefs = await getOwnerAccountRefs(supabase, ownerId);
  const tiktokRefs = accountRefs.filter((account) => account.platform === "tiktok");
  const selectedAccountId =
    params.account && tiktokRefs.some((account) => account.id === params.account)
      ? params.account
      : undefined;

  const allPosts = await getOwnerScheduledPosts(supabase, ownerId, {
    platform: "tiktok",
    accountId: selectedAccountId,
    order: "asc",
  });
  const upcomingPosts = allPosts.filter((post) => post.status === "pending").slice(0, 12);

  const rows = allPosts;
  const stats = {
    pending: rows.filter((post) => post.status === "pending").length,
    published: rows.filter((post) => post.status === "published").length,
    failed: rows.filter((post) => post.status === "failed").length,
  };

  return (
    <>
      <header className="ig-page-header">
        <h1>TikTok</h1>
        <p>Conecte contas, envie vídeos em massa e deixe a IA agendar publicações.</p>
      </header>

        <OAuthAlert
          error={params.error}
          connected={params.connected}
          platform={params.platform === "tiktok" ? "tiktok" : undefined}
          tiktokEnabled={isTikTokOAuthConfigured()}
        />

        {!isTikTokOAuthConfigured() && (
          <div className="mb-6 rounded-xl border border-ig-info-border bg-ig-info-bg px-4 py-3 text-sm text-ig-muted">
            Configure <strong className="text-ig-text">TIKTOK_CLIENT_KEY</strong> e{" "}
            <strong className="text-ig-text">TIKTOK_CLIENT_SECRET</strong> na Vercel e crie o app
            em developers.tiktok.com com Login Kit + Content Posting API.
          </div>
        )}

        <div className="mb-8 grid gap-4 sm:grid-cols-3">
          {[
            { label: "Pendentes", value: stats.pending },
            { label: "Publicados", value: stats.published },
            { label: "Falhas", value: stats.failed },
          ].map((item) => (
            <div key={item.label} className="ig-stat p-4">
              <p className="text-sm text-ig-muted">{item.label}</p>
              <p className="text-3xl font-bold text-ig-text">{item.value}</p>
            </div>
          ))}
        </div>

        <div className="mb-8 flex flex-wrap gap-3">
          <a href="/dashboard/bulk?platform=tiktok" className="ig-btn inline-flex items-center gap-2 px-4 py-2 text-sm">
            <Upload size={16} />
            Upload em massa
          </a>
          <a
            href="/dashboard/calendar"
            className="ig-btn-secondary inline-flex items-center gap-2 px-4 py-2 text-sm"
          >
            <Calendar size={16} />
            Calendário
          </a>
          <a
            href="/dashboard/accounts"
            className="ig-btn-secondary inline-flex items-center gap-2 px-4 py-2 text-sm"
          >
            <Users size={16} />
            Todas as contas
          </a>
        </div>

        <section className="ig-panel mb-8 p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-ig-text">Próximos posts TikTok</h2>
            <a href="/dashboard/reports?platform=tiktok" className="text-sm text-ig-primary hover:underline">
              Ver todos →
            </a>
          </div>

          <AccountFilterBar
            accounts={tiktokRefs}
            selectedAccountId={selectedAccountId}
            selectedPlatform={"tiktok" as SocialPlatform}
            basePath="/dashboard/tiktok"
            showPlatformTabs={false}
          />

          <PostsManager posts={upcomingPosts} enableBulk={false} />

          {!upcomingPosts.length && (
            <p className="text-sm text-ig-muted">
              Nenhum post TikTok agendado ainda.{" "}
              <a href="/dashboard/bulk?platform=tiktok" className="text-ig-primary hover:underline">
                Enviar vídeos
              </a>
            </p>
          )}
        </section>

        <section className="ig-panel p-5">
          <h2 className="mb-4 text-lg font-semibold text-ig-text">Contas TikTok</h2>
          <TikTokAccountsSection connectHref="/api/auth/tiktok?next=/dashboard/tiktok&add_account=1" />
        </section>
    </>
  );
}
