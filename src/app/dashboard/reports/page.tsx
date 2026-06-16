import { redirect } from "next/navigation";
import { Navbar } from "@/components/Navbar";
import { OperationsCenter } from "@/components/operations/OperationsCenter";
import { getOwnerAccounts } from "@/lib/accounts";
import {
  computeOperationsSnapshot,
  filterPostsByPeriod,
} from "@/lib/operations/compute";
import { getSessionUserId } from "@/lib/meta/oauth";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ScheduledPost } from "@/lib/types";

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

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; account?: string; period?: string }>;
}) {
  const ownerId = await getSessionUserId();
  if (!ownerId) redirect("/login?next=/dashboard/reports");

  const params = await searchParams;
  const filter: StatusFilter = isStatusFilter(params.status) ? params.status : "all";
  const period: PeriodFilter = isPeriodFilter(params.period) ? params.period : "all";

  const supabase = createAdminClient();
  const accounts = await getOwnerAccounts(supabase, ownerId);
  const accountIds = accounts.map((account) => account.id);
  const selectedAccountId =
    params.account && accountIds.includes(params.account) ? params.account : accounts[0]?.id;
  const filteredAccountIds = selectedAccountId ? [selectedAccountId] : accountIds;

  const { data: allPostsRaw } = await supabase
    .from("scheduled_posts")
    .select("*, instagram_accounts(ig_username, profile_picture_url)")
    .in("account_id", filteredAccountIds)
    .eq("hidden_from_report", false)
    .order("scheduled_at", { ascending: true })
    .limit(500);

  const allPosts = (allPostsRaw as ScheduledPost[]) ?? [];
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
    <div>
      <Navbar />
      <main className="mx-auto max-w-6xl px-4 py-8">
        <OperationsCenter
          accounts={accounts.map((account) => ({
            id: account.id,
            ig_username: account.ig_username,
            profile_picture_url: account.profile_picture_url,
          }))}
          selectedAccountId={selectedAccountId ?? accounts[0]?.id ?? ""}
          posts={visiblePosts}
          snapshot={snapshot}
          statusFilter={filter}
          periodFilter={period}
        />
      </main>
    </div>
  );
}
