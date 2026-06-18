import { redirect } from "next/navigation";
import { AccountFilterBar } from "@/components/AccountFilterBar";
import {
  buildOperationalLogRows,
  OperationalLogsList,
} from "@/components/operations/OperationalLogsList";
import { getSessionUserId } from "@/lib/meta/oauth";
import { getOwnerAccountRefs, getOwnerScheduledPosts } from "@/lib/posts";
import { createAdminClient } from "@/lib/supabase/admin";
import type { PublishLog, ScheduledPost, SocialPlatform } from "@/lib/types";

export const dynamic = "force-dynamic";

function isPlatformFilter(value: string | undefined): value is SocialPlatform | "all" {
  return value === "instagram" || value === "tiktok" || value === "all" || value === undefined;
}

export default async function LogsPage({
  searchParams,
}: {
  searchParams: Promise<{ account?: string; platform?: string; level?: string; q?: string }>;
}) {
  const ownerId = await getSessionUserId();
  if (!ownerId) redirect("/login?next=/dashboard/logs");

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

  const posts = await getOwnerScheduledPosts(supabase, ownerId, {
    platform: platformFilter,
    accountId: selectedAccountId,
  });
  const postIds = posts.map((post) => post.id);
  const postsById = new Map(posts.map((post) => [post.id, post as ScheduledPost]));

  let query = supabase
    .from("publish_logs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(300);

  if (postIds.length) {
    query = query.in("post_id", postIds);
  } else {
    query = query.limit(0);
  }

  const { data: logs } = await query;

  let rows = buildOperationalLogRows((logs ?? []) as PublishLog[], postsById);

  if (params.level && params.level !== "all") {
    rows = rows.filter((row) => row.level === params.level);
  }

  if (params.q?.trim()) {
    const needle = params.q.trim().toLowerCase();
    rows = rows.filter(
      (row) =>
        row.message.toLowerCase().includes(needle) ||
        row.accountUsername.toLowerCase().includes(needle) ||
        row.eventLabel.toLowerCase().includes(needle),
    );
  }

  return (
    <div className="mx-auto max-w-5xl">
      <header className="ig-page-header">
        <h1>Logs operacionais</h1>
        <p>Histórico enriquecido de publicações, retries, falhas e eventos do cron.</p>
      </header>

      <AccountFilterBar
        accounts={accountRefs}
        selectedAccountId={selectedAccountId}
        selectedPlatform={platformFilter}
        basePath="/dashboard/logs"
      />

      <form action="/dashboard/logs" method="get" className="mb-4 flex flex-wrap gap-2">
        {platformFilter !== "all" && <input type="hidden" name="platform" value={platformFilter} />}
        {selectedAccountId && <input type="hidden" name="account" value={selectedAccountId} />}
        <input
          name="q"
          defaultValue={params.q ?? ""}
          placeholder="Buscar mensagem, conta ou evento…"
          className="ig-input min-w-[220px] flex-1 text-sm"
        />
        <select name="level" defaultValue={params.level ?? "all"} className="ig-input text-sm">
          <option value="all">Todos os níveis</option>
          <option value="info">Info</option>
          <option value="success">Sucesso</option>
          <option value="error">Erro</option>
        </select>
        <button type="submit" className="ig-btn px-4 py-2 text-sm">
          Filtrar
        </button>
      </form>

      <OperationalLogsList rows={rows} />
    </div>
  );
}
