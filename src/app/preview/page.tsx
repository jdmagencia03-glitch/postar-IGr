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
      <div className="border-b border-ig-primary/30 bg-ig-primary/10 px-4 py-2 text-center text-sm text-ig-link">
        Modo Preview — dados simulados para demonstração
      </div>
      <Navbar />
      <main className="mx-auto max-w-6xl px-4 py-8">
        <section className="mb-12">
          <h2 className="mb-4 text-xl font-bold text-ig-text">Dashboard</h2>
          <div className="mb-6 grid gap-4 sm:grid-cols-3">
            {[
              { label: "Pendentes", value: 878, color: "text-ig-warning" },
              { label: "Publicados", value: 2, color: "text-ig-success" },
              { label: "Falhas", value: 1, color: "text-ig-danger" },
            ].map((s) => (
              <div key={s.label} className="rounded-xl border border-ig-border bg-ig-secondary p-4">
                <p className="text-sm text-ig-muted">{s.label}</p>
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
          <h2 className="mb-4 text-xl font-bold text-ig-text">Agendamento em massa</h2>
          <div className="rounded-2xl border border-ig-border bg-ig-secondary p-6">
            <div className="space-y-4">
              <div className="rounded-lg border border-dashed border-ig-border p-8 text-center text-ig-muted">
                📁 881 vídeos selecionados
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="text-sm text-ig-muted">Data de início</p>
                  <p className="text-ig-text">15/06/2026 09:00</p>
                </div>
                <div>
                  <p className="text-sm text-ig-muted">Posts por dia</p>
                  <p className="text-ig-text">5 (9h, 12h, 15h, 18h, 21h)</p>
                </div>
              </div>
              <p className="text-sm text-ig-success">→ 881 posts distribuídos em ~176 dias</p>
              <button className="w-full rounded-lg bg-ig-primary px-4 py-3 font-medium text-ig-text">
                Agendar em massa
              </button>
            </div>
          </div>
        </section>

        <section className="mb-12">
          <h2 className="mb-4 text-xl font-bold text-ig-text">
            Calendário — {format(now, "MMMM yyyy", { locale: ptBR })}
          </h2>
          <div className="grid gap-3 sm:grid-cols-4 lg:grid-cols-7">
            {days.slice(0, 14).map((day) => {
              const count = day.getDate() % 5 === 0 ? 5 : day.getDate() % 3 === 0 ? 3 : 0;
              return (
                <div key={day.toISOString()} className="min-h-20 rounded-xl border border-ig-border bg-ig-secondary p-2">
                  <p className="text-xs font-medium text-ig-text">{format(day, "dd/MM")}</p>
                  {count > 0 ? (
                    <p className="mt-1 text-xs text-ig-primary">{count} posts</p>
                  ) : (
                    <p className="mt-1 text-xs text-ig-muted">—</p>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        <section>
          <h2 className="mb-4 text-xl font-bold text-ig-text">Logs</h2>
          <div className="space-y-3">
            {mockLogs.map((log) => (
              <div key={log.id} className="rounded-xl border border-ig-border bg-ig-secondary p-4">
                <span className={`text-xs uppercase ${log.level === "success" ? "text-ig-success" : log.level === "error" ? "text-ig-danger" : "text-ig-link"}`}>
                  {log.level}
                </span>
                <p className="mt-1 text-sm text-ig-text">{log.message}</p>
              </div>
            ))}
          </div>
        </section>

        <div className="mt-12 text-center">
          <Link href="/" className="text-ig-primary hover:underline">
            ← Voltar para a página inicial
          </Link>
        </div>
      </main>
    </div>
  );
}
