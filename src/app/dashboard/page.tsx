import { redirect } from "next/navigation";
import { DashboardNextPostsPanel } from "@/components/dashboard/DashboardNextPostsPanel";
import { DashboardStatsRow } from "@/components/dashboard/DashboardStatsRow";
import { DashboardUploadCard } from "@/components/dashboard/DashboardUploadCard";
import { DashboardWelcomeBanner } from "@/components/dashboard/DashboardWelcomeBanner";
import { OnboardingSteps } from "@/components/OnboardingSteps";
import { PublisherHealthBanner } from "@/components/PublisherHealthBanner";
import { getPlaybookForOwner, playbookHasContent } from "@/lib/ai/playbook";
import { getSessionUserId } from "@/lib/meta/oauth";
import { getOwnerScheduledPosts } from "@/lib/posts";
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

  const playbook = await getPlaybookForOwner(ownerId);
  const playbookReady = playbookHasContent(playbook);

  const postFilters = {
    platform: platformFilter,
    order: "asc" as const,
  };

  const posts = await getOwnerScheduledPosts(supabase, ownerId, { ...postFilters, limit: 12 });
  const allPosts = await getOwnerScheduledPosts(supabase, ownerId, postFilters);

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
