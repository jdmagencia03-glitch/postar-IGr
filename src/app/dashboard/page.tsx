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
import { isActiveQueueStatus, isHudVisibleStatus } from "@/lib/operations/post-status";
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
    loadError = "O banco está temporariamente lento. Alguns dados podem demorar para carregar.";
  }
  const playbookReady = playbookReadyResult ?? false;

  const postFilters = {
    platform: platformFilter,
    order: "asc" as const,
  };

  const allPostsResult = await withTimeoutOrNull(
    getOwnerScheduledPosts(supabase, ownerId, postFilters),
    DB_ROUTE_TIMEOUT_MS,
    "dashboard-posts-all",
  );

  if (allPostsResult === null) {
    loadError =
      loadError ??
      "Não foi possível carregar seus posts agora. Tente novamente em instantes.";
  }

  const allPosts: ScheduledPost[] = allPostsResult ?? [];
  const hudPosts = allPosts.filter((post) => isHudVisibleStatus(post.status));
  const queuePosts = hudPosts.filter((post) => isActiveQueueStatus(post.status));
  const posts = queuePosts.slice(0, 12);

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const stats = {
    pending: hudPosts.filter((p) => p.status === "pending" || p.status === "retrying").length,
    published: hudPosts.filter((p) => p.status === "published").length,
    publishedLast7Days: hudPosts.filter(
      (p) =>
        p.status === "published" &&
        p.published_at &&
        new Date(p.published_at) >= sevenDaysAgo,
    ).length,
    failed: hudPosts.filter((p) => p.status === "failed" || p.status === "failed_persistent").length,
  };
  const hasScheduledPosts = hudPosts.some(
    (p) =>
      p.status === "pending" ||
      p.status === "published" ||
      p.status === "failed" ||
      p.status === "failed_persistent" ||
      p.status === "retrying" ||
      p.status === "needs_media",
  );

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
        <DashboardNextPostsPanel posts={posts} allPosts={hudPosts} />
        <DashboardUploadCard />
      </div>
    </div>
  );
}
