import { redirect } from "next/navigation";
import { AccountFilterBar } from "@/components/AccountFilterBar";
import { OperationalLogsList } from "@/components/operations/OperationalLogsList";
import { buildOperationalLogRows } from "@/lib/operations/operational-logs";
import { getSessionUserId } from "@/lib/meta/oauth";
import {
  fetchPublishLogsForPostIds,
  getOwnerAccountRefs,
  getOwnerPostsForLogs,
} from "@/lib/posts";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ScheduledPost, SocialPlatform } from "@/lib/types";

export const dynamic = "force-dynamic";

function isPlatformFilter(value: string | undefined): value is SocialPlatform | "all" {
  return value === "instagram" || value === "tiktok" || value === "all" || value === undefined;
}

export default async function LogsPage({
  searchParams,
}: {
  searchParams: Promise<{ account?: string; platform?: string; level?: string; q?: string; post?: string }>;
}) {
  const ownerId = await getSessionUserId();
  if (!ownerId) redirect("/login?next=/dashboard/logs");

  const params = await searchParams;
  const platformFilter: SocialPlatform | "all" = isPlatformFilter(params.platform)
    ? params.platform ?? "all"
    : "all";

  let accountRefs: Awaited<ReturnType<typeof getOwnerAccountRefs>> = [];
  let rows: ReturnType<typeof buildOperationalLogRows> = [];
  let errorMessage: string | undefined;
  let selectedAccountId: string | undefined;

  try {
    const supabase = createAdminClient();
    accountRefs = await getOwnerAccountRefs(supabase, ownerId);
    const visibleRefs = accountRefs.filter(
      (account) => platformFilter === "all" || account.platform === platformFilter,
    );
    selectedAccountId =
      params.account && visibleRefs.some((account) => account.id === params.account)
        ? params.account
        : undefined;

    const { posts, error: postsError } = await getOwnerPostsForLogs(supabase, ownerId, {
      platform: platformFilter,
      accountId: selectedAccountId,
    });
    const postIds = posts.map((post) => post.id);
    const postsById = new Map(posts.map((post) => [post.id, post as ScheduledPost]));

    const { logs, error: logsError } = await fetchPublishLogsForPostIds(supabase, postIds);
    const combinedError = [postsError, logsError].filter(Boolean).join("; ") || null;

    rows = buildOperationalLogRows(logs, postsById);

    if (params.level && params.level !== "all") {
      rows = rows.filter((row) => row.level === params.level);
    }

    if (params.post) {
      rows = rows.filter((row) => row.postId === params.post);
    }

    if (params.q?.trim()) {
      const needle = params.q.trim().toLowerCase();
      rows = rows.filter(
        (row) =>
          (row.message ?? "").toLowerCase().includes(needle) ||
          (row.accountUsername ?? "").toLowerCase().includes(needle) ||
          (row.eventLabel ?? "").toLowerCase().includes(needle),
      );
    }

    if (combinedError) {
      console.error("[logs-page] load failed:", combinedError);
      errorMessage = "Não foi possível carregar os logs agora. Tente novamente.";
    }
  } catch (error) {
    console.error("[logs-page] unexpected error:", error);
    errorMessage = "Não foi possível carregar os logs agora. Tente novamente.";
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

      <OperationalLogsList rows={rows} errorMessage={errorMessage} />
    </div>
  );
}
