import { redirect } from "next/navigation";
import { OperationsCenter } from "@/components/operations/OperationsCenter";
import {
  computeOperationsSnapshot,
  filterPostsByPeriod,
} from "@/lib/operations/compute";
import { getSessionUserId } from "@/lib/meta/oauth";
import { getOwnerAccountRefs, getOwnerScheduledPosts } from "@/lib/posts";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ScheduledPost, SocialPlatform, ContentType } from "@/lib/types";

export const dynamic = "force-dynamic";

const statusLabels = {
  all: "Todos",
  pending: "Pendentes",
  processing: "Publicando",
  published: "Publicados",
  failed: "Falhas",
} as const;

type StatusFilter = keyof typeof statusLabels;
type PeriodFilter = "all" | "today" | "tomorrow" | "week" | "month";

function isStatusFilter(value: string | undefined): value is StatusFilter {
  return value !== undefined && value in statusLabels;
}

function isPeriodFilter(value: string | undefined): value is PeriodFilter {
  return value === "all" || value === "today" || value === "tomorrow" || value === "week" || value === "month";
}

function isPlatformFilter(value: string | undefined): value is SocialPlatform | "all" {
  return value === "instagram" || value === "tiktok" || value === "all" || value === undefined;
}

function isContentTypeFilter(value: string | undefined): value is ContentType | "all" {
  return (
    value === "reel" ||
    value === "post" ||
    value === "story" ||
    value === "tiktok_video" ||
    value === "youtube_short" ||
    value === "all" ||
    value === undefined
  );
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string;
    account?: string;
    period?: string;
    platform?: string;
    content_type?: string;
  }>;
}) {
  const ownerId = await getSessionUserId();
  if (!ownerId) redirect("/login?next=/dashboard/reports");

  const params = await searchParams;
  const filter: StatusFilter = isStatusFilter(params.status) ? params.status : "all";
  const period: PeriodFilter = isPeriodFilter(params.period) ? params.period : "all";
  const platformFilter: SocialPlatform | "all" = isPlatformFilter(params.platform)
    ? params.platform ?? "all"
    : "all";
  const contentTypeFilter: ContentType | "all" = isContentTypeFilter(params.content_type)
    ? params.content_type ?? "all"
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

  const allPosts = await getOwnerScheduledPosts(supabase, ownerId, {
    platform: platformFilter,
    accountId: selectedAccountId,
    contentType: contentTypeFilter,
    hiddenFromReport: false,
    order: "asc",
    limit: 2000,
  });

  const snapshot = computeOperationsSnapshot(allPosts);

  let visiblePosts = allPosts;

  if (filter !== "all") {
    visiblePosts = visiblePosts.filter((post) => post.status === filter);
  }

  visiblePosts = filterPostsByPeriod(visiblePosts, period);
  visiblePosts = [...visiblePosts].sort(
    (a, b) => new Date(b.scheduled_at).getTime() - new Date(a.scheduled_at).getTime(),
  );

  return (
    <>
      <header className="ig-page-header">
        <h1>Central de operações</h1>
        <p>Monitore publicações, falhas e fila de posts.</p>
      </header>
      <OperationsCenter
          accounts={accountRefs.map((account) => ({
            id: account.id,
            platform: account.platform,
            ig_username: account.username,
            profile_picture_url: account.profile_picture_url,
          }))}
          selectedAccountId={selectedAccountId ?? ""}
          selectedPlatform={platformFilter}
          selectedContentType={contentTypeFilter}
          posts={visiblePosts as ScheduledPost[]}
          snapshot={snapshot}
          statusFilter={filter}
          periodFilter={period}
        />
    </>
  );
}
