import { redirect } from "next/navigation";
import { DashboardLoadErrorBanner } from "@/components/dashboard/DashboardLoadErrorBanner";
import { DashboardNextPostsPanel } from "@/components/dashboard/DashboardNextPostsPanel";
import { DashboardStatsRow } from "@/components/dashboard/DashboardStatsRow";
import { DashboardUploadCard } from "@/components/dashboard/DashboardUploadCard";
import { DashboardWelcomeBanner } from "@/components/dashboard/DashboardWelcomeBanner";
import { OnboardingSteps } from "@/components/OnboardingSteps";
import { PublisherHealthBanner } from "@/components/PublisherHealthBanner";
import { ownerHasConfiguredPlaybook } from "@/lib/ai/playbook";
import { getSessionUserId } from "@/lib/meta/oauth";
import { getOwnerScheduledPosts } from "@/lib/posts";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ScheduledPost, SocialPlatform } from "@/lib/types";
import { withTimeoutOrNull, DB_ROUTE_TIMEOUT_MS } from "@/lib/with-timeout";

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
  let loadError: string | null = null;

  const playbookReadyResult = await withTimeoutOrNull(
    ownerHasConfiguredPlaybook(ownerId),
    DB_ROUTE_TIMEOUT_MS,
    "dashboard-playbook",
  );
  if (playbookReadyResult === null) {
    loadError = "Não foi possível carregar contas agora. Tente novamente em instantes.";
  }
  const playbookReady = playbookReadyResult ?? false;

  const postFilters = {
    platform: platformFilter,
    order: "asc" as const,
  };

  const recentPostsResult = await withTimeoutOrNull(
    getOwnerScheduledPosts(supabase, ownerId, { ...postFilters, limit: 12 }),
    DB_ROUTE_TIMEOUT_MS,
    "dashboard-posts-recent",
  );
  const allPostsResult = await withTimeoutOrNull(
    getOwnerScheduledPosts(supabase, ownerId, postFilters),
    DB_ROUTE_TIMEOUT_MS,
    "dashboard-posts-all",
  );

  if (recentPostsResult === null || allPostsResult === null) {
    loadError = "Não foi possível carregar contas agora. Tente novamente em instantes.";
  }

  const posts: ScheduledPost[] = recentPostsResult ?? [];
  const allPosts: ScheduledPost[] = allPostsResult ?? [];

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const stats = {
    pending: allPosts.filter((p) => p.status === "pending").length,
    published: allPosts.filter((p) => p.status === "published").length,
    publishedLast7Days: allPosts.filter(
      (p) =>
        p.status === "published" &&
        p.published_at &&
        new Date(p.published_at) >= sevenDaysAgo,
    ).length,
    failed: allPosts.filter((p) => p.status === "failed").length,
  };
  const hasScheduledPosts = stats.pending + stats.published + stats.failed > 0;

  return (
    <div className="mx-auto max-w-6xl space-y-6 pb-4">
      {loadError ? <DashboardLoadErrorBanner message={loadError} /> : null}

      <PublisherHealthBanner />

      <DashboardWelcomeBanner />

      <OnboardingSteps
        playbookReady={playbookReady}
        hasScheduledPosts={hasScheduledPosts}
        currentStep={playbookReady ? 2 : 1}
      />

      <DashboardStatsRow stats={stats} />

      <div className="grid gap-4 lg:grid-cols-2 lg:items-stretch">
        <DashboardNextPostsPanel posts={posts} allPosts={allPosts} />
        <DashboardUploadCard />
      </div>
    </div>
  );
}
