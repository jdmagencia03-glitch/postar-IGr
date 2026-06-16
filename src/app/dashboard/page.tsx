import { redirect } from "next/navigation";
import { Sparkles } from "lucide-react";
import { Navbar } from "@/components/Navbar";
import { OnboardingSteps } from "@/components/OnboardingSteps";
import { PostsManager } from "@/components/PostsManager";
import { getOwnerAccounts } from "@/lib/accounts";
import { getPlaybookForOwner, playbookHasContent } from "@/lib/ai/playbook";
import { getSessionUserId } from "@/lib/meta/oauth";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ScheduledPost } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const ownerId = await getSessionUserId();
  if (!ownerId) redirect("/login?next=/dashboard");

  const supabase = createAdminClient();
  const accounts = await getOwnerAccounts(supabase, ownerId);
  const accountIds = accounts.map((a) => a.id);
  const playbook = await getPlaybookForOwner(ownerId);
  const playbookReady = playbookHasContent(playbook);

  const { data: posts } = await supabase
    .from("scheduled_posts")
    .select("*, instagram_accounts(ig_username, profile_picture_url)")
    .in("account_id", accountIds)
    .order("scheduled_at", { ascending: true })
    .limit(12);

  const { data: allPosts } = await supabase
    .from("scheduled_posts")
    .select("status")
    .in("account_id", accountIds);

  const rows = allPosts ?? [];
  const stats = {
    pending: rows.filter((p) => p.status === "pending").length,
    published: rows.filter((p) => p.status === "published").length,
    failed: rows.filter((p) => p.status === "failed").length,
  };
  const hasScheduledPosts = stats.pending + stats.published + stats.failed > 0;

  return (
    <div>
      <Navbar />
      <main className="mx-auto max-w-6xl px-4 py-8">
        <section className="ig-hero mb-10 p-8 text-center">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-ig-info-border bg-ig-info-bg px-4 py-1.5 text-sm font-medium text-ig-info-text">
            <Sparkles size={16} />
            Hands-off
          </div>
          <h1 className="mb-3 text-3xl font-bold text-ig-text">
            Envie os vídeos. A IA programa tudo.
          </h1>
          <p className="mx-auto mb-6 max-w-xl text-ig-muted">
            Legendas virais, hashtags e horários estratégicos — semanas ou meses de conteúdo em
            minutos. Envie e a IA agenda em 1 clique.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <a
              href={playbookReady ? "/dashboard/bulk" : "/dashboard/ai"}
              className="ig-btn px-6 py-3"
            >
              {playbookReady ? "Enviar vídeos agora" : "Começar — configurar estilo"}
            </a>
            {playbookReady ? (
              <a
                href="/dashboard/ai"
                className="ig-btn-secondary px-6 py-3"
              >
                Ajustar estilo
              </a>
            ) : (
              <a
                href="/dashboard/bulk"
                className="ig-btn-secondary px-6 py-3"
              >
                Pular e enviar vídeos
              </a>
            )}
          </div>
          {accounts.length > 0 && (
            <p className="mt-4 text-xs text-ig-muted">
              {accounts.length} conta(s) conectada(s) ·{" "}
              <a href="/dashboard/accounts" className="text-ig-primary hover:underline">
                Gerenciar
              </a>
            </p>
          )}
        </section>

        <OnboardingSteps
          playbookReady={playbookReady}
          hasScheduledPosts={hasScheduledPosts}
          currentStep={playbookReady ? 2 : 1}
        />

        <div className="mb-8 grid gap-4 sm:grid-cols-3">
          {[
            { label: "Pendentes", value: stats.pending, color: "text-ig-muted" },
            { label: "Publicados", value: stats.published, color: "text-ig-text" },
            { label: "Falhas", value: stats.failed, color: "text-ig-danger" },
          ].map((s) => (
            <div
              key={s.label}
              className="ig-stat p-4"
            >
              <p className="text-sm text-ig-muted">{s.label}</p>
              <p className={`text-3xl font-bold ${s.color}`}>{s.value}</p>
            </div>
          ))}
        </div>

        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-ig-text">Próximos posts</h2>
          <a href="/dashboard/reports" className="text-sm text-ig-primary hover:underline">
            Ver central de operações →
          </a>
        </div>

        <PostsManager posts={(posts as ScheduledPost[]) ?? []} enableBulk />

        {!posts?.length && (
          <div className="rounded-xl border border-dashed border-ig-border bg-ig-elevated p-12 text-center text-ig-muted shadow-sm">
            Nenhum post agendado ainda.{" "}
            <a href="/dashboard/bulk" className="text-ig-primary hover:underline">
              Envie seus vídeos — a IA cuida do resto
            </a>
          </div>
        )}
      </main>
    </div>
  );
}
