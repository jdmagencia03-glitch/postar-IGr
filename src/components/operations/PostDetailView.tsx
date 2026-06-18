"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { PostCard } from "@/components/PostCard";
import { PostTimeline } from "@/components/operations/PostTimeline";
import { StatusBadge } from "@/components/StatusBadge";
import { CONTENT_TYPE_LABELS } from "@/lib/content-types";
import { buildPostTimeline } from "@/lib/operations/post-timeline";
import { destinationLabel } from "@/lib/operations/group-status";
import { getPostAccountUsername } from "@/lib/posts";
import { fromDateTimeLocalInAppTz, toDateTimeLocalInAppTz } from "@/lib/timezone";
import type { ContentType, PublishLog, ScheduledPost } from "@/lib/types";
import { formatDateTime } from "@/lib/utils";

interface Props {
  post: ScheduledPost;
  siblingPosts: ScheduledPost[];
  logs: PublishLog[];
}

export function PostDetailView({ post, siblingPosts, logs }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [captionDraft, setCaptionDraft] = useState(post.caption ?? "");
  const [scheduleDraft, setScheduleDraft] = useState(toDateTimeLocalInAppTz(post.scheduled_at));

  const timeline = buildPostTimeline(post, logs);
  const username = getPostAccountUsername(post);
  const contentType = (post.content_type ?? "reel") as ContentType;
  const accountId = post.platform === "tiktok" ? post.tiktok_account_id : post.account_id;

  async function apiAction(path: string, init?: RequestInit) {
    setLoading(true);
    setMessage(null);
    try {
      const response = await fetch(path, { ...init, credentials: "include" });
      const data = await response.json();
      if (!response.ok) throw new Error(String(data.error ?? "Falha na operação"));
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Erro");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-ig-muted">
            {post.platform === "tiktok" ? "TikTok" : "Instagram"} · {CONTENT_TYPE_LABELS[contentType]}
          </p>
          <h1 className="mt-1 text-2xl font-bold text-ig-text">@{username}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <StatusBadge status={post.status} />
            {post.parent_publish_group_id && (
              <span className="rounded-full bg-ig-primary/10 px-2 py-0.5 text-xs text-ig-primary">
                Multiplataforma
              </span>
            )}
          </div>
        </div>
        <Link href="/dashboard/reports" className="text-sm text-ig-primary hover:underline">
          ← Voltar para operações
        </Link>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="max-w-md">
          <PostCard post={post} rich />
        </div>

        <div className="space-y-4 rounded-2xl border border-ig-border bg-ig-elevated p-5">
          <h2 className="text-sm font-bold text-ig-text">Detalhes</h2>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-ig-muted">Agendado</dt>
              <dd>{formatDateTime(post.scheduled_at)}</dd>
            </div>
            {post.published_at && (
              <div className="flex justify-between gap-3">
                <dt className="text-ig-muted">Publicado</dt>
                <dd>{formatDateTime(post.published_at)}</dd>
              </div>
            )}
            <div className="flex justify-between gap-3">
              <dt className="text-ig-muted">Retry count</dt>
              <dd>{post.retry_count ?? 0}</dd>
            </div>
            {post.next_retry_at && (
              <div className="flex justify-between gap-3">
                <dt className="text-ig-muted">Próximo retry</dt>
                <dd>{formatDateTime(post.next_retry_at)}</dd>
              </div>
            )}
            {post.error_message && (
              <div>
                <dt className="text-ig-muted">Erro</dt>
                <dd className="mt-1 text-ig-danger">{post.error_message}</dd>
              </div>
            )}
            {post.story_cta && (
              <div className="flex justify-between gap-3">
                <dt className="text-ig-muted">CTA</dt>
                <dd>{post.story_cta}</dd>
              </div>
            )}
          </dl>

          <div className="flex flex-wrap gap-2 pt-2">
            {post.permalink && (
              <a href={post.permalink} target="_blank" rel="noreferrer" className="ig-btn-secondary px-3 py-2 text-xs">
                Ver publicação
              </a>
            )}
            {accountId && (
              <Link
                href={`/dashboard/accounts/${accountId}/diagnostics?platform=${post.platform ?? "instagram"}`}
                className="rounded-lg border border-ig-border px-3 py-2 text-xs hover:bg-ig-secondary"
              >
                Abrir conta
              </Link>
            )}
            <button
              type="button"
              disabled={loading}
              onClick={() => apiAction(`/api/posts/${post.id}/retry`, { method: "POST" })}
              className="rounded-lg border border-ig-border px-3 py-2 text-xs hover:bg-ig-secondary disabled:opacity-50"
            >
              Tentar novamente
            </button>
            <button
              type="button"
              disabled={loading}
              onClick={() => apiAction(`/api/posts/${post.id}/duplicate`, { method: "POST" })}
              className="rounded-lg border border-ig-border px-3 py-2 text-xs hover:bg-ig-secondary disabled:opacity-50"
            >
              Duplicar
            </button>
          </div>

          <div className="space-y-2 border-t border-ig-border pt-4">
            <label className="text-xs font-medium text-ig-muted">Editar legenda</label>
            <textarea value={captionDraft} onChange={(e) => setCaptionDraft(e.target.value)} rows={4} className="ig-input w-full text-sm" />
            <button
              type="button"
              disabled={loading}
              onClick={() =>
                apiAction(`/api/posts/${post.id}`, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ caption: captionDraft }),
                })
              }
              className="ig-btn px-3 py-2 text-xs disabled:opacity-50"
            >
              Salvar legenda
            </button>
          </div>

          <div className="space-y-2 border-t border-ig-border pt-4">
            <label className="text-xs font-medium text-ig-muted">Reagendar</label>
            <input type="datetime-local" value={scheduleDraft} onChange={(e) => setScheduleDraft(e.target.value)} className="ig-input w-full text-sm" />
            <button
              type="button"
              disabled={loading}
              onClick={() =>
                apiAction(`/api/posts/${post.id}`, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ scheduled_at: fromDateTimeLocalInAppTz(scheduleDraft) }),
                })
              }
              className="ig-btn px-3 py-2 text-xs disabled:opacity-50"
            >
              Reagendar
            </button>
          </div>

          {message && <p className="text-xs text-ig-danger">{message}</p>}
        </div>
      </div>

      {siblingPosts.length > 0 && (
        <section className="rounded-2xl border border-ig-border bg-ig-elevated p-5">
          <h2 className="text-sm font-bold text-ig-text">Publicações irmãs (multiplataforma)</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {siblingPosts.map((sibling) => (
              <Link
                key={sibling.id}
                href={`/dashboard/posts/${sibling.id}`}
                className="rounded-xl border border-ig-border p-3 hover:bg-ig-secondary"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">{destinationLabel(sibling)}</span>
                  <StatusBadge status={sibling.status} />
                </div>
                <p className="mt-1 text-xs text-ig-muted">{formatDateTime(sibling.scheduled_at)}</p>
                {sibling.error_message && (
                  <p className="mt-1 text-xs text-ig-danger line-clamp-2">{sibling.error_message}</p>
                )}
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="rounded-2xl border border-ig-border bg-ig-elevated p-5">
        <h2 className="text-sm font-bold text-ig-text">Histórico / logs</h2>
        <div className="mt-4">
          <PostTimeline events={timeline} />
        </div>
      </section>
    </div>
  );
}
