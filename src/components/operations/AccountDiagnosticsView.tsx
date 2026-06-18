"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ValidatePermissionsButton } from "@/components/operations/ValidatePermissionsButton";
import { TestPublishButton } from "@/components/operations/TestPublishButton";
import { OperationsAlertsPanel } from "@/components/operations/OperationsAlertsPanel";
import { PostsManager } from "@/components/PostsManager";
import { StatusBadge } from "@/components/StatusBadge";
import { healthClass, healthLabel } from "@/lib/operations/account-ops";
import type { OperationsAlert } from "@/lib/operations/alerts-engine";
import { formatShortDateTime } from "@/lib/operations/compute";
import type { AccountOperationsSummary } from "@/lib/operations/account-ops";
import type { ScheduledPost, SocialPlatform } from "@/lib/types";

interface DiagnosticsPayload {
  account: AccountOperationsSummary;
  diagnostics: {
    connectionStatus: string;
    connectionMessage: string | null;
    permissions: string[];
    playbookConfigured: boolean;
    niche: string | null;
    recentLogs: Array<{ level: string; message: string; created_at: string }>;
  };
  alerts: OperationsAlert[];
  posts: {
    pending: ScheduledPost[];
    failed: ScheduledPost[];
    processing: ScheduledPost[];
    published: ScheduledPost[];
  };
}

export function AccountDiagnosticsView({
  accountId,
  platform,
  initial,
}: {
  accountId: string;
  platform: SocialPlatform;
  initial: DiagnosticsPayload;
}) {
  const router = useRouter();
  const [paused, setPaused] = useState(initial.account.publishingPaused);
  const [pauseLoading, setPauseLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const username = initial.account.username ? `@${initial.account.username}` : "conta";
  const reconnectHref =
    platform === "tiktok"
      ? `/api/auth/tiktok?next=/dashboard/accounts/${accountId}/diagnostics?platform=tiktok`
      : `/api/auth/meta?next=/dashboard/accounts/${accountId}/diagnostics?platform=instagram`;

  async function togglePause() {
    setPauseLoading(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/operations/accounts/${accountId}/pause`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ platform, paused: !paused }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(String(data.error ?? "Falha ao atualizar pausa"));
      setPaused(!paused);
      setMessage(String(data.message ?? "Atualizado"));
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Erro ao pausar conta");
    } finally {
      setPauseLoading(false);
    }
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium uppercase tracking-wide text-ig-muted">
            {platform === "tiktok" ? "TikTok" : "Instagram"}
          </p>
          <h1 className="text-2xl font-bold text-ig-text">Diagnóstico — {username}</h1>
          <p className="mt-1 text-sm text-ig-muted">
            Status, conexão, fila e erros desta conta.
          </p>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-sm font-semibold ${healthClass(initial.account.health)}`}
        >
          {healthLabel(initial.account.health)}
        </span>
      </div>

      <OperationsAlertsPanel alerts={initial.alerts} />

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-ig-border bg-ig-elevated p-5">
          <h2 className="text-lg font-semibold text-ig-text">Conexão</h2>
          <dl className="mt-4 space-y-2 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-ig-muted">Token</dt>
              <dd className="font-medium text-ig-text">
                {initial.diagnostics.connectionStatus === "valid"
                  ? "Válido"
                  : initial.diagnostics.connectionStatus === "expired"
                    ? "Expirado"
                    : "Desconhecido"}
              </dd>
            </div>
            {initial.diagnostics.connectionMessage && (
              <p className="text-ig-muted">{initial.diagnostics.connectionMessage}</p>
            )}
            {initial.diagnostics.permissions.length > 0 && (
              <div>
                <dt className="text-ig-muted">Permissões</dt>
                <dd className="mt-1 text-xs text-ig-text">
                  {initial.diagnostics.permissions.join(", ")}
                </dd>
              </div>
            )}
          </dl>
          <div className="mt-4 space-y-4">
            <ValidatePermissionsButton accountId={accountId} platform={platform} />
            <TestPublishButton accountId={accountId} platform={platform} />
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <a href={reconnectHref} className="ig-btn-secondary px-4 py-2 text-sm">
              Reconectar
            </a>
            <button
              type="button"
              disabled={pauseLoading}
              onClick={() => void togglePause()}
              className="rounded-lg border border-ig-border px-4 py-2 text-sm font-medium hover:bg-ig-secondary disabled:opacity-50"
            >
              {paused ? "Retomar publicações" : "Pausar publicações"}
            </button>
          </div>
          {message && <p className="mt-2 text-sm text-ig-muted">{message}</p>}
        </div>

        <div className="rounded-2xl border border-ig-border bg-ig-elevated p-5">
          <h2 className="text-lg font-semibold text-ig-text">Assistente de conteúdo</h2>
          <dl className="mt-4 space-y-2 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-ig-muted">Playbook</dt>
              <dd className="font-medium text-ig-text">
                {initial.diagnostics.playbookConfigured ? "Configurado" : "Pendente"}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-ig-muted">Nicho</dt>
              <dd className="font-medium text-ig-text">{initial.diagnostics.niche || "—"}</dd>
            </div>
          </dl>
          <Link href={`/dashboard/ai?account=${accountId}`} className="ig-btn-secondary mt-4 inline-block px-4 py-2 text-sm">
            Abrir assistente
          </Link>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Hoje", initial.account.publishedToday],
          ["7 dias", initial.account.publishedLast7Days],
          ["30 dias", initial.account.publishedLast30Days],
          ["Pendentes", initial.account.pendingCount],
          ["Falhas", initial.account.failedCount],
          ["Falha persistente", initial.account.failedPersistentCount],
          ["Taxa sucesso", `${initial.account.successRate}%`],
          ["Tipo mais usado", initial.account.topContentType ?? "—"],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-2xl border border-ig-border bg-ig-elevated p-4">
            <p className="text-sm text-ig-muted">{label}</p>
            <p className="mt-1 text-2xl font-bold text-ig-text">{value}</p>
          </div>
        ))}
      </section>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Publicando", initial.posts.processing.length],
          ["Publicados (recentes)", initial.posts.published.length],
          [
            "Próxima publicação",
            initial.account.nextPublication
              ? formatShortDateTime(initial.account.nextPublication)
              : "—",
          ],
          [
            "Última publicação",
            initial.account.lastPublication
              ? formatShortDateTime(initial.account.lastPublication)
              : "—",
          ],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-2xl border border-ig-border bg-ig-elevated p-4">
            <p className="text-sm text-ig-muted">{label}</p>
            <p className="mt-1 text-lg font-bold text-ig-text">{value}</p>
          </div>
        ))}
      </section>

      <section className="rounded-2xl border border-ig-border bg-ig-elevated p-5">
        <h2 className="text-lg font-semibold text-ig-text">Fila e publicações</h2>
        <div className="mt-4 space-y-3">
          {[...initial.posts.processing, ...initial.posts.pending, ...initial.posts.failed]
            .slice(0, 12)
            .map((post) => (
              <div
                key={post.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-ig-border bg-ig-secondary px-4 py-3 text-sm"
              >
                <div>
                  <p className="font-medium text-ig-text">
                    {post.content_type ?? "reel"} · {formatShortDateTime(post.scheduled_at)}
                  </p>
                  {post.error_message && (
                    <p className="mt-1 text-xs text-ig-danger">{post.error_message}</p>
                  )}
                </div>
                <StatusBadge status={post.status} />
                <Link
                  href={`/dashboard/posts/${post.id}`}
                  className="text-xs text-ig-primary hover:underline"
                >
                  Detalhes
                </Link>
              </div>
            ))}
        </div>
      </section>

      {initial.posts.failed.length > 0 && (
        <section>
          <h2 className="mb-4 text-lg font-semibold text-ig-text">Posts com falha</h2>
          <PostsManager posts={initial.posts.failed} enableBulk rich />
        </section>
      )}

      <section className="rounded-2xl border border-ig-border bg-ig-elevated p-5">
        <h2 className="text-lg font-semibold text-ig-text">Logs recentes</h2>
        <div className="mt-4 space-y-2">
          {initial.diagnostics.recentLogs.length ? (
            initial.diagnostics.recentLogs.map((log, index) => (
              <div key={`${log.created_at}-${index}`} className="rounded-lg bg-ig-secondary px-3 py-2 text-xs">
                <span className="font-medium uppercase text-ig-muted">{log.level}</span>
                <span className="mx-2 text-ig-muted">·</span>
                <span className="text-ig-text">{log.message}</span>
              </div>
            ))
          ) : (
            <p className="text-sm text-ig-muted">Nenhum log recente.</p>
          )}
        </div>
        <Link href="/dashboard/logs" className="mt-3 inline-block text-sm text-ig-primary hover:underline">
          Ver todos os logs
        </Link>
      </section>
    </div>
  );
}
