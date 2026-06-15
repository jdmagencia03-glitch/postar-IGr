import { redirect } from "next/navigation";
import { Sparkles } from "lucide-react";
import { Navbar } from "@/components/Navbar";
import { OnboardingSteps } from "@/components/OnboardingSteps";
import { PostCard } from "@/components/PostCard";
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
        <section className="mb-10 rounded-2xl border border-pink-500/20 bg-gradient-to-br from-pink-500/10 via-purple-500/5 to-transparent p-8 text-center">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-pink-500/30 bg-pink-500/10 px-4 py-1.5 text-sm text-pink-200">
            <Sparkles size={16} />
            Hands-off
          </div>
          <h1 className="mb-3 text-3xl font-bold text-white">
            Envie os vídeos. A IA programa tudo.
          </h1>
          <p className="mx-auto mb-6 max-w-xl text-zinc-400">
            Legendas virais, hashtags e horários estratégicos — semanas ou meses de conteúdo em
            minutos. Envie e a IA agenda em 1 clique.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <a
              href={playbookReady ? "/dashboard/bulk" : "/dashboard/ai"}
              className="rounded-lg bg-gradient-to-r from-pink-500 to-purple-600 px-6 py-3 font-medium text-white hover:opacity-90"
            >
              {playbookReady ? "Enviar vídeos agora" : "Começar — treinar IA"}
            </a>
            {playbookReady ? (
              <a
                href="/dashboard/ai"
                className="rounded-lg border border-white/10 bg-white/5 px-6 py-3 text-zinc-200 hover:bg-white/10"
              >
                Ajustar IA
              </a>
            ) : (
              <a
                href="/dashboard/bulk"
                className="rounded-lg border border-white/10 bg-white/5 px-6 py-3 text-zinc-200 hover:bg-white/10"
              >
                Pular e enviar vídeos
              </a>
            )}
          </div>
          {accounts.length > 0 && (
            <p className="mt-4 text-xs text-zinc-500">
              {accounts.length} conta(s) conectada(s) ·{" "}
              <a href="/dashboard/accounts" className="text-pink-400 hover:underline">
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
            { label: "Pendentes", value: stats.pending, color: "text-amber-300" },
            { label: "Publicados", value: stats.published, color: "text-emerald-300" },
            { label: "Falhas", value: stats.failed, color: "text-red-300" },
          ].map((s) => (
            <div
              key={s.label}
              className="rounded-xl border border-white/10 bg-white/5 p-4"
            >
              <p className="text-sm text-zinc-400">{s.label}</p>
              <p className={`text-3xl font-bold ${s.color}`}>{s.value}</p>
            </div>
          ))}
        </div>

        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Próximos posts</h2>
          <a href="/dashboard/reports" className="text-sm text-pink-400 hover:underline">
            Ver relatório →
          </a>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {(posts as ScheduledPost[])?.map((post) => (
            <PostCard key={post.id} post={post} />
          ))}
        </div>

        {!posts?.length && (
          <div className="rounded-xl border border-dashed border-white/20 p-12 text-center text-zinc-400">
            Nenhum post agendado ainda.{" "}
            <a href="/dashboard/bulk" className="text-pink-400 hover:underline">
              Envie seus vídeos — a IA cuida do resto
            </a>
          </div>
        )}
      </main>
    </div>
  );
}
