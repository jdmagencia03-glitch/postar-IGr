import { redirect } from "next/navigation";
import { AccountFilterBar } from "@/components/AccountFilterBar";
import { OnboardingSteps } from "@/components/OnboardingSteps";
import { PostsManager } from "@/components/PostsManager";
import { PublisherHealthBanner } from "@/components/PublisherHealthBanner";
import { getPlaybookForOwner, playbookHasContent } from "@/lib/ai/playbook";
import { getSessionUserId } from "@/lib/meta/oauth";
import { getOwnerAccountRefs, getOwnerScheduledPosts } from "@/lib/posts";
import { createAdminClient } from "@/lib/supabase/admin";
import type { SocialPlatform } from "@/lib/types";

export const dynamic = "force-dynamic";

function isPlatformFilter(value: string | undefined): value is SocialPlatform | "all" {
  return value === "instagram" || value === "tiktok" || value === "all" || value === undefined;
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ account?: string; platform?: string }>;
}) {
  const ownerId = await getSessionUserId();
  if (!ownerId) redirect("/login?next=/dashboard");

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

  const playbook = await getPlaybookForOwner(ownerId);
  const playbookReady = playbookHasContent(playbook);

  const postFilters = {
    platform: platformFilter,
    accountId: selectedAccountId,
    order: "asc" as const,
  };

  const posts = await getOwnerScheduledPosts(supabase, ownerId, { ...postFilters, limit: 12 });
  const allPosts = await getOwnerScheduledPosts(supabase, ownerId, postFilters);

  const rows = allPosts;
  const stats = {
    pending: rows.filter((p) => p.status === "pending").length,
    published: rows.filter((p) => p.status === "published").length,
    failed: rows.filter((p) => p.status === "failed").length,
  };
  const hasScheduledPosts = stats.pending + stats.published + stats.failed > 0;

  return (
    <>
      <PublisherHealthBanner />

      <header className="ig-page-header flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1>Início</h1>
          <p>Envie vídeos, a IA agenda legendas e horários automaticamente.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href={playbookReady ? "/dashboard/bulk" : "/dashboard/ai"} className="ig-btn px-5 py-2.5">
            {playbookReady ? "Agendar posts" : "Configurar estilo da IA"}
          </a>
          {playbookReady && (
            <a href="/dashboard/ai" className="ig-btn-secondary px-5 py-2.5">
              Ajustar IA
            </a>
          )}
        </div>
      </header>

      <OnboardingSteps
        playbookReady={playbookReady}
        hasScheduledPosts={hasScheduledPosts}
        currentStep={playbookReady ? 2 : 1}
      />

      <AccountFilterBar
        accounts={accountRefs}
        selectedAccountId={selectedAccountId}
        selectedPlatform={platformFilter}
        basePath="/dashboard"
      />

      <div className="mb-8 grid gap-3 sm:grid-cols-3">
        {[
          { label: "Pendentes", value: stats.pending, color: "text-ig-muted" },
          { label: "Publicados", value: stats.published, color: "text-ig-text" },
          { label: "Falhas", value: stats.failed, color: "text-ig-danger" },
        ].map((s) => (
          <div key={s.label} className="ig-stat p-4">
            <p className="text-sm text-ig-muted">{s.label}</p>
            <p className={`text-2xl font-normal ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-medium text-ig-text">Próximos posts</h2>
        <a href="/dashboard/reports" className="text-sm text-ig-primary hover:underline">
          Ver operações
        </a>
      </div>

      <div className="ig-panel overflow-hidden">
        <PostsManager posts={posts} bulkScopePosts={allPosts} enableBulk />

        {!allPosts.length && (
          <div className="border-t border-ig-border px-6 py-12 text-center text-ig-muted">
            Nenhum post agendado ainda.{" "}
            <a href="/dashboard/bulk" className="text-ig-primary hover:underline">
              Enviar vídeos
            </a>
          </div>
        )}
      </div>
    </>
  );
}
