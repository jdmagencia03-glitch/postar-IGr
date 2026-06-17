import { AppShell } from "@/components/AppShell";
import { PostCard } from "@/components/PostCard";
import { format, endOfMonth, eachDayOfInterval, startOfMonth } from "date-fns";
import { ptBR } from "date-fns/locale";
import Link from "next/link";
import type { ScheduledPost } from "@/lib/types";

const mockPosts: ScheduledPost[] = [
  {
    id: "1",
    account_id: "a1",
    media_type: "REELS",
    media_urls: ["https://example.com/video1.mp4"],
    caption: "Post #1 — Conteúdo do dia com legenda gerada pela IA.",
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
    caption: "Post #2 — Mais um reel agendado automaticamente.",
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
  {
    id: "1",
    level: "success" as const,
    message: "Publicado: https://instagram.com/reel/example",
    created_at: new Date().toISOString(),
  },
  {
    id: "2",
    level: "info" as const,
    message: "Iniciando publicação do post #3",
    created_at: new Date().toISOString(),
  },
  {
    id: "3",
    level: "error" as const,
    message: "Timeout aguardando processamento da mídia",
    created_at: new Date().toISOString(),
  },
];

export default function PreviewPage() {
  const now = new Date();
  const days = eachDayOfInterval({ start: startOfMonth(now), end: endOfMonth(now) });

  return (
    <AppShell>
      <div className="mb-4 rounded-lg border border-ig-info-border bg-ig-info-bg px-4 py-2 text-sm text-ig-info-text">
        Modo preview — dados simulados · layout local em{" "}
        <code className="rounded bg-ig-elevated px-1.5 py-0.5 text-xs">localhost:3001/preview</code>
      </div>

      <header className="ig-page-header flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1>Início</h1>
          <p>Envie vídeos, a IA agenda legendas e horários automaticamente.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="ig-btn px-5 py-2.5">Agendar posts</span>
          <span className="ig-btn-secondary px-5 py-2.5">Ajustar IA</span>
        </div>
      </header>

      <div className="mb-8 grid gap-3 sm:grid-cols-3">
        {[
          { label: "Pendentes", value: 878, color: "text-ig-muted" },
          { label: "Publicados", value: 2, color: "text-ig-text" },
          { label: "Falhas", value: 1, color: "text-ig-danger" },
        ].map((s) => (
          <div key={s.label} className="ig-stat p-4">
            <p className="text-sm text-ig-muted">{s.label}</p>
            <p className={`text-2xl font-normal ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-medium text-ig-text">Próximos posts</h2>
        <span className="text-sm text-ig-primary">Ver operações</span>
      </div>

      <div className="ig-panel mb-10 overflow-hidden p-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {mockPosts.map((post) => (
            <PostCard key={post.id} post={post} />
          ))}
        </div>
      </div>

      <section className="mb-10">
        <header className="ig-page-header">
          <h1>Agendar posts</h1>
          <p>Envie vários vídeos de uma vez. A IA cria legendas e agenda automaticamente.</p>
        </header>
        <div className="ig-panel p-6">
          <div className="rounded-xl border border-dashed border-ig-border px-8 py-10 text-center text-ig-muted">
            881 vídeos selecionados
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <p className="text-sm text-ig-muted">Data de início</p>
              <p className="text-ig-text">15/06/2026 09:00</p>
            </div>
            <div>
              <p className="text-sm text-ig-muted">Posts por dia</p>
              <p className="text-ig-text">5 (9h, 12h, 15h, 18h, 21h)</p>
            </div>
          </div>
          <p className="mt-4 text-sm text-ig-muted">881 posts distribuídos em ~176 dias</p>
          <button type="button" className="ig-btn mt-4 w-full px-4 py-3">
            Agendar em massa
          </button>
        </div>
      </section>

      <section className="mb-10">
        <header className="ig-page-header">
          <h1>Calendário</h1>
          <p>{format(now, "MMMM yyyy", { locale: ptBR })} · Instagram e TikTok</p>
        </header>
        <div className="ig-panel grid gap-2 p-4 sm:grid-cols-4 lg:grid-cols-7">
          {days.slice(0, 14).map((day) => {
            const count = day.getDate() % 5 === 0 ? 5 : day.getDate() % 3 === 0 ? 3 : 0;
            return (
              <div key={day.toISOString()} className="min-h-20 rounded-lg border border-ig-border bg-ig-secondary p-2">
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

      <section className="mb-8">
        <header className="ig-page-header">
          <h1>Logs de publicação</h1>
          <p>Histórico de tentativas e resultados.</p>
        </header>
        <div className="ig-panel divide-y divide-ig-border overflow-hidden">
          {mockLogs.map((log) => (
            <div key={log.id} className="px-4 py-3">
              <span
                className={`text-xs font-medium uppercase ${
                  log.level === "success"
                    ? "text-ig-text"
                    : log.level === "error"
                      ? "text-ig-danger"
                      : "text-ig-link"
                }`}
              >
                {log.level}
              </span>
              <p className="mt-1 text-sm text-ig-text">{log.message}</p>
            </div>
          ))}
        </div>
      </section>

      <p className="text-center text-sm text-ig-muted">
        <Link href="/login" className="text-ig-primary hover:underline">
          Ir para login
        </Link>
        {" · "}
        <Link href="/" className="text-ig-primary hover:underline">
          Página inicial
        </Link>
      </p>
    </AppShell>
  );
}
