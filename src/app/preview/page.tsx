import { Navbar } from "@/components/Navbar";
import { PostCard } from "@/components/PostCard";
import { StatusBadge } from "@/components/StatusBadge";
import { format, parseISO, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay } from "date-fns";
import { ptBR } from "date-fns/locale";
import type { ScheduledPost } from "@/lib/types";
import Link from "next/link";

const mockPosts: ScheduledPost[] = [
  {
    id: "1",
    account_id: "a1",
    media_type: "REELS",
    media_urls: ["https://example.com/video1.mp4"],
    caption: "Post #1 🎬 Conteúdo incrível do dia!",
    scheduled_at: new Date(Date.now() + 3600000).toISOString(),
    status: "pending",
    container_id: null,
    media_id: null,
    permalink: null,
    error_message: null,
    published_at: null,
    created_at: new Date().toISOString(),
    instagram_accounts: { ig_username: "ryo__oya", profile_picture_url: null },
  },
  {
    id: "2",
    account_id: "a1",
    media_type: "REELS",
    media_urls: ["https://example.com/video2.mp4"],
    caption: "Post #2 ✨ Mais um reel agendado",
    scheduled_at: new Date(Date.now() + 7200000).toISOString(),
    status: "pending",
    container_id: null,
    media_id: null,
    permalink: null,
    error_message: null,
    published_at: null,
    created_at: new Date().toISOString(),
    instagram_accounts: { ig_username: "ryo__oya", profile_picture_url: null },
  },
  {
    id: "3",
    account_id: "a1",
    media_type: "REELS",
    media_urls: ["https://example.com/video3.mp4"],
    caption: "Post publicado com sucesso!",
    scheduled_at: new Date(Date.now() - 86400000).toISOString(),
    status: "published",
    container_id: "c1",
    media_id: "m1",
    permalink: "https://instagram.com/reel/example",
    error_message: null,
    published_at: new Date(Date.now() - 86400000).toISOString(),
    created_at: new Date().toISOString(),
    instagram_accounts: { ig_username: "ryo__oya", profile_picture_url: null },
  },
];

const mockLogs = [
  { id: "1", level: "success" as const, message: "Publicado: https://instagram.com/reel/example", created_at: new Date().toISOString() },
  { id: "2", level: "info" as const, message: "Iniciando publicação do post #3", created_at: new Date().toISOString() },
  { id: "3", level: "error" as const, message: "Timeout aguardando processamento da mídia", created_at: new Date().toISOString() },
];

export default function PreviewPage() {
  const now = new Date();
  const days = eachDayOfInterval({ start: startOfMonth(now), end: endOfMonth(now) });

  return (
    <div>
      <div className="border-b border-pink-500/30 bg-pink-500/10 px-4 py-2 text-center text-sm text-pink-300">
        Modo Preview — dados simulados para demonstração
      </div>
      <Navbar />
      <main className="mx-auto max-w-6xl px-4 py-8">
        <section className="mb-12">
          <h2 className="mb-4 text-xl font-bold text-white">Dashboard</h2>
          <div className="mb-6 grid gap-4 sm:grid-cols-3">
            {[
              { label: "Pendentes", value: 878, color: "text-amber-300" },
              { label: "Publicados", value: 2, color: "text-emerald-300" },
              { label: "Falhas", value: 1, color: "text-red-300" },
            ].map((s) => (
              <div key={s.label} className="rounded-xl border border-white/10 bg-white/5 p-4">
                <p className="text-sm text-zinc-400">{s.label}</p>
                <p className={`text-3xl font-bold ${s.color}`}>{s.value}</p>
              </div>
            ))}
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {mockPosts.map((post) => (
              <PostCard key={post.id} post={post} />
            ))}
          </div>
        </section>

        <section className="mb-12">
          <h2 className="mb-4 text-xl font-bold text-white">Agendamento em massa</h2>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
            <div className="space-y-4">
              <div className="rounded-lg border border-dashed border-white/20 p-8 text-center text-zinc-400">
                📁 881 vídeos selecionados
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="text-sm text-zinc-400">Data de início</p>
                  <p className="text-white">15/06/2026 09:00</p>
                </div>
                <div>
                  <p className="text-sm text-zinc-400">Posts por dia</p>
                  <p className="text-white">5 (9h, 12h, 15h, 18h, 21h)</p>
                </div>
              </div>
              <p className="text-sm text-emerald-400">→ 881 posts distribuídos em ~176 dias</p>
              <button className="w-full rounded-lg bg-gradient-to-r from-pink-500 to-purple-600 px-4 py-3 font-medium text-white">
                Agendar em massa
              </button>
            </div>
          </div>
        </section>

        <section className="mb-12">
          <h2 className="mb-4 text-xl font-bold text-white">
            Calendário — {format(now, "MMMM yyyy", { locale: ptBR })}
          </h2>
          <div className="grid gap-3 sm:grid-cols-4 lg:grid-cols-7">
            {days.slice(0, 14).map((day) => {
              const count = day.getDate() % 5 === 0 ? 5 : day.getDate() % 3 === 0 ? 3 : 0;
              return (
                <div key={day.toISOString()} className="min-h-20 rounded-xl border border-white/10 bg-white/5 p-2">
                  <p className="text-xs font-medium text-white">{format(day, "dd/MM")}</p>
                  {count > 0 ? (
                    <p className="mt-1 text-xs text-pink-400">{count} posts</p>
                  ) : (
                    <p className="mt-1 text-xs text-zinc-600">—</p>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        <section>
          <h2 className="mb-4 text-xl font-bold text-white">Logs</h2>
          <div className="space-y-3">
            {mockLogs.map((log) => (
              <div key={log.id} className="rounded-xl border border-white/10 bg-white/5 p-4">
                <span className={`text-xs uppercase ${log.level === "success" ? "text-emerald-300" : log.level === "error" ? "text-red-300" : "text-blue-300"}`}>
                  {log.level}
                </span>
                <p className="mt-1 text-sm text-zinc-300">{log.message}</p>
              </div>
            ))}
          </div>
        </section>

        <div className="mt-12 text-center">
          <Link href="/" className="text-pink-400 hover:underline">
            ← Voltar para a página inicial
          </Link>
        </div>
      </main>
    </div>
  );
}
