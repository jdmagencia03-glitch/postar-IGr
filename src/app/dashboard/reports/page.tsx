import { redirect } from "next/navigation";
import { Navbar } from "@/components/Navbar";
import { AccountsRanking } from "@/components/AccountsRanking";
import { PostCard } from "@/components/PostCard";
import { ReportsInsights } from "@/components/ReportsInsights";
import { getOwnerAccounts } from "@/lib/accounts";
import { getSessionUserId } from "@/lib/meta/oauth";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatDateTime } from "@/lib/utils";
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

function isStatusFilter(value: string | undefined): value is StatusFilter {
  return value !== undefined && value in statusLabels;
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; account?: string }>;
}) {
  const ownerId = await getSessionUserId();
  if (!ownerId) redirect("/login?next=/dashboard/reports");

  const params = await searchParams;
  const filter: StatusFilter = isStatusFilter(params.status) ? params.status : "all";

  const supabase = createAdminClient();
  const accounts = await getOwnerAccounts(supabase, ownerId);
  const accountIds = accounts.map((a) => a.id);
  const selectedAccountId =
    params.account && accountIds.includes(params.account) ? params.account : undefined;
  const filteredAccountIds = selectedAccountId ? [selectedAccountId] : accountIds;

  let query = supabase
    .from("scheduled_posts")
    .select("*, instagram_accounts(ig_username, profile_picture_url)")
    .in("account_id", filteredAccountIds)
    .order("scheduled_at", { ascending: false })
    .limit(100);

  if (filter !== "all") {
    query = query.eq("status", filter);
  }

  const { data: posts } = await query;

  const { data: allForStats } = await supabase
    .from("scheduled_posts")
    .select("status, published_at, scheduled_at")
    .in("account_id", filteredAccountIds);

  const rows = allForStats ?? [];
  const stats = {
    pending: rows.filter((p) => p.status === "pending").length,
    processing: rows.filter((p) => p.status === "processing").length,
    published: rows.filter((p) => p.status === "published").length,
    failed: rows.filter((p) => p.status === "failed").length,
    total: rows.length,
  };

  const successRate =
    stats.published + stats.failed > 0
      ? Math.round((stats.published / (stats.published + stats.failed)) * 100)
      : 0;

  const nextPending = rows
    .filter((p) => p.status === "pending")
    .sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime())[0];

  const lastPublished = rows
    .filter((p) => p.status === "published" && p.published_at)
    .sort((a, b) => new Date(b.published_at!).getTime() - new Date(a.published_at!).getTime())[0];

  const allPosts = (posts as ScheduledPost[]) ?? [];

  function buildReportsHref(status?: StatusFilter) {
    const query = new URLSearchParams();
    if (selectedAccountId) query.set("account", selectedAccountId);
    if (status && status !== "all") query.set("status", status);
    const qs = query.toString();
    return qs ? `/dashboard/reports?${qs}` : "/dashboard/reports";
  }

  return (
    <div>
      <Navbar />
      <main className="mx-auto max-w-6xl px-4 py-8">
        <h1 className="mb-2 text-2xl font-bold text-ig-text">Relatório</h1>
        <p className="mb-8 text-ig-muted">
          Métricas reais do Instagram, ranking Top 10 e status dos seus agendamentos.
        </p>

        <AccountsRanking />

        <ReportsInsights
          accounts={accounts.map((a) => ({
            id: a.id,
            ig_username: a.ig_username,
          }))}
          initialAccountId={selectedAccountId ?? accounts[0]?.id}
        />

        {accounts.length > 1 && (
          <div className="mb-6 flex flex-wrap gap-2">
            <a
              href={`/dashboard/reports${filter !== "all" ? `?status=${filter}` : ""}`}
              className={`rounded-full px-4 py-2 text-sm transition ${
                !selectedAccountId
                  ? "bg-ig-primary text-ig-text"
                  : "border border-ig-border bg-ig-secondary text-ig-text hover:bg-ig-secondary"
              }`}
            >
              Todas as contas
            </a>
            {accounts.map((account) => {
              const href = `/dashboard/reports?account=${account.id}${
                filter !== "all" ? `&status=${filter}` : ""
              }`;
              return (
                <a
                  key={account.id}
                  href={href}
                  className={`rounded-full px-4 py-2 text-sm transition ${
                    selectedAccountId === account.id
                      ? "bg-ig-primary text-ig-text"
                      : "border border-ig-border bg-ig-secondary text-ig-text hover:bg-ig-secondary"
                  }`}
                >
                  @{account.ig_username}
                </a>
              );
            })}
          </div>
        )}

        <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {[
            { label: "Total agendado", value: stats.total, color: "text-ig-text" },
            { label: "Pendentes", value: stats.pending, color: "text-ig-muted" },
            { label: "Publicando", value: stats.processing, color: "text-ig-link" },
            { label: "Publicados", value: stats.published, color: "text-ig-text" },
            { label: "Falhas", value: stats.failed, color: "text-ig-danger" },
          ].map((item) => (
            <div
              key={item.label}
              className="rounded-xl border border-ig-border bg-ig-secondary p-4"
            >
              <p className="text-sm text-ig-muted">{item.label}</p>
              <p className={`text-3xl font-bold ${item.color}`}>{item.value}</p>
            </div>
          ))}
        </div>

        <div className="mb-8 grid gap-4 sm:grid-cols-3">
          <div className="rounded-xl border border-ig-border bg-ig-secondary p-4">
            <p className="text-sm text-ig-muted">Taxa de sucesso</p>
            <p className="text-3xl font-bold text-ig-text">{successRate}%</p>
          </div>
          <div className="rounded-xl border border-ig-border bg-ig-secondary p-4">
            <p className="text-sm text-ig-muted">Próximo post</p>
            <p className="text-lg font-medium text-ig-text">
              {nextPending ? formatDateTime(nextPending.scheduled_at) : "Nenhum"}
            </p>
          </div>
          <div className="rounded-xl border border-ig-border bg-ig-secondary p-4">
            <p className="text-sm text-ig-muted">Última publicação</p>
            <p className="text-lg font-medium text-ig-text">
              {lastPublished?.published_at
                ? formatDateTime(lastPublished.published_at)
                : "Nenhuma ainda"}
            </p>
          </div>
        </div>

        <div className="mb-6 flex flex-wrap gap-2">
          {(Object.keys(statusLabels) as StatusFilter[]).map((status) => (
            <a
              key={status}
              href={buildReportsHref(status)}
              className={`rounded-full px-4 py-2 text-sm transition ${
                filter === status
                  ? "bg-ig-primary text-ig-text"
                  : "border border-ig-border bg-ig-secondary text-ig-text hover:bg-ig-secondary"
              }`}
            >
              {statusLabels[status]}
            </a>
          ))}
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {allPosts.map((post) => (
            <div key={post.id}>
              <PostCard post={post} />
              {post.status === "published" && post.published_at && (
                <p className="mt-2 text-xs text-ig-text">
                  Publicado em {formatDateTime(post.published_at)}
                </p>
              )}
            </div>
          ))}
        </div>

        {!allPosts.length && (
          <div className="rounded-xl border border-dashed border-ig-border p-12 text-center text-ig-muted">
            Nenhum post neste filtro.{" "}
            <a href="/dashboard/bulk" className="text-ig-primary hover:underline">
              Agendar um vídeo
            </a>
          </div>
        )}
      </main>
    </div>
  );
}
