import { redirect } from "next/navigation";
import { Navbar } from "@/components/Navbar";
import { PostCard } from "@/components/PostCard";
import { getSessionUserId } from "@/lib/meta/oauth";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ScheduledPost } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const userId = await getSessionUserId();
  if (!userId) redirect("/login");

  const supabase = createAdminClient();
  const { data: accounts } = await supabase
    .from("instagram_accounts")
    .select("*")
    .eq("user_id", userId);

  const accountIds = accounts?.map((a) => a.id) ?? [];

  const { data: posts } = await supabase
    .from("scheduled_posts")
    .select("*, instagram_accounts(ig_username, profile_picture_url)")
    .in("account_id", accountIds)
    .order("scheduled_at", { ascending: true })
    .limit(12);

  const stats = {
    pending: posts?.filter((p) => p.status === "pending").length ?? 0,
    published: posts?.filter((p) => p.status === "published").length ?? 0,
    failed: posts?.filter((p) => p.status === "failed").length ?? 0,
  };

  return (
    <div>
      <Navbar />
      <main className="mx-auto max-w-6xl px-4 py-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white">Dashboard</h1>
          <p className="text-zinc-400">
            {accounts?.length
              ? `${accounts.length} conta(s) conectada(s)`
              : "Nenhuma conta conectada"}
          </p>
        </div>

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
          <a href="/dashboard/bulk" className="text-sm text-pink-400 hover:underline">
            Agendar em massa →
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
              Agende seu primeiro lote
            </a>
          </div>
        )}
      </main>
    </div>
  );
}
