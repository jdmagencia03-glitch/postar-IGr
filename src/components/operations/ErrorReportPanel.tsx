"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { StatusBadge } from "@/components/StatusBadge";
import { formatDateTime } from "@/lib/utils";
import type { ErrorReportSummary } from "@/lib/operations/error-report";

interface Props {
  report: ErrorReportSummary;
}

export function ErrorReportPanel({ report }: Props) {
  const router = useRouter();

  async function handleRetry(postId: string) {
    const response = await fetch(`/api/posts/${postId}/retry`, {
      method: "POST",
      credentials: "include",
    });
    if (response.ok) router.refresh();
  }

  return (
    <div className="space-y-6">
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-ig-border bg-ig-elevated p-4">
          <p className="text-xs text-ig-muted">Erros hoje</p>
          <p className="mt-1 text-2xl font-bold text-ig-danger">{report.errorsToday}</p>
        </div>
        <div className="rounded-2xl border border-ig-border bg-ig-elevated p-4">
          <p className="text-xs text-ig-muted">Erros 7 dias</p>
          <p className="mt-1 text-2xl font-bold text-ig-danger">{report.errorsLast7Days}</p>
        </div>
        <div className="rounded-2xl border border-ig-border bg-ig-elevated p-4">
          <p className="text-xs text-ig-muted">Falha persistente</p>
          <p className="mt-1 text-2xl font-bold text-ig-danger">{report.failedPersistent}</p>
        </div>
        <div className="rounded-2xl border border-ig-border bg-ig-elevated p-4">
          <p className="text-xs text-ig-muted">Presos em publishing</p>
          <p className="mt-1 text-2xl font-bold text-amber-600">{report.stuckProcessing}</p>
        </div>
      </section>

      {report.topErrors.length > 0 && (
        <section className="rounded-2xl border border-ig-border bg-ig-elevated p-5">
          <h3 className="text-sm font-bold text-ig-text">Erros mais comuns</h3>
          <ul className="mt-3 space-y-2">
            {report.topErrors.map((item) => (
              <li key={item.message} className="flex items-start justify-between gap-3 text-sm">
                <span className="text-ig-text">{item.message}</span>
                <span className="shrink-0 font-semibold text-ig-danger">{item.count}x</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="overflow-x-auto rounded-2xl border border-ig-border">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-ig-secondary text-xs uppercase text-ig-muted">
            <tr>
              <th className="px-4 py-3">Conta</th>
              <th className="px-4 py-3">Plataforma</th>
              <th className="px-4 py-3">Tipo</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Erro</th>
              <th className="px-4 py-3">Data</th>
              <th className="px-4 py-3">Tentativas</th>
              <th className="px-4 py-3">Ações</th>
            </tr>
          </thead>
          <tbody>
            {report.items.map((item) => (
              <tr key={item.postId} className="border-t border-ig-border align-top">
                <td className="px-4 py-3">@{item.accountUsername}</td>
                <td className="px-4 py-3 capitalize">{item.platform}</td>
                <td className="px-4 py-3">{item.contentTypeLabel}</td>
                <td className="px-4 py-3">
                  <StatusBadge status={item.status} />
                </td>
                <td className="max-w-xs px-4 py-3 text-xs text-ig-danger">{item.errorMessage}</td>
                <td className="px-4 py-3 text-xs text-ig-muted">{formatDateTime(item.scheduledAt)}</td>
                <td className="px-4 py-3">{item.retryCount}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void handleRetry(item.postId)}
                      className="rounded-lg border border-ig-border px-2 py-1 text-xs hover:bg-ig-secondary"
                    >
                      Retry
                    </button>
                    <Link
                      href={`/dashboard/posts/${item.postId}`}
                      className="rounded-lg border border-ig-border px-2 py-1 text-xs hover:bg-ig-secondary"
                    >
                      Detalhes
                    </Link>
                    {item.actionHref?.startsWith("/api/") ? (
                      <a
                        href={item.actionHref}
                        className="rounded-lg border border-ig-primary/30 px-2 py-1 text-xs text-ig-primary hover:bg-ig-primary/10"
                      >
                        {item.recommendedAction}
                      </a>
                    ) : item.actionHref ? (
                      <Link
                        href={item.actionHref}
                        className="rounded-lg border border-ig-primary/30 px-2 py-1 text-xs text-ig-primary hover:bg-ig-primary/10"
                      >
                        {item.recommendedAction}
                      </Link>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!report.items.length && (
          <p className="px-4 py-8 text-center text-sm text-ig-muted">Nenhum erro no filtro atual.</p>
        )}
      </section>
    </div>
  );
}
