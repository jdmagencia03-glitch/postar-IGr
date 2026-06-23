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
import {
  filterDashboardQueuePosts,
  getOwnerDashboardData,
} from "@/lib/posts/dashboard-data";
import type { SocialPlatform } from "@/lib/types";
import { createAdminClient } from "@/lib/supabase/admin";
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

  const [playbookReadyResult, dashboardData] = await Promise.all([
    withTimeoutOrNull(ownerHasConfiguredPlaybook(ownerId, supabase), DB_ROUTE_TIMEOUT_MS, "dashboard-playbook"),
    getOwnerDashboardData(supabase, ownerId, platformFilter),
  ]);

  if (playbookReadyResult === null) {
    loadError = "O banco está temporariamente lento. Alguns dados podem demorar para carregar.";
  }
  const playbookReady = playbookReadyResult ?? false;

  if (dashboardData === null) {
    loadError =
      loadError ??
      "Não foi possível carregar seus posts agora. Tente novamente em instantes.";
  }

  const stats = dashboardData?.stats ?? {
    pending: 0,
    published: 0,
    publishedLast7Days: 0,
    failed: 0,
  };
  const hudPosts = dashboardData?.hudPosts ?? [];
  const posts = filterDashboardQueuePosts(hudPosts);
  const hasScheduledPosts = dashboardData?.hasScheduledPosts ?? false;

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
