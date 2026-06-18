"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { StatusBadge } from "@/components/StatusBadge";
import {
  auditRowsToCsv,
  auditStatusClass,
  auditStatusLabel,
  type PublicationAuditReport,
} from "@/lib/operations/publication-audit";
import { buildReportQuery, type AuditPeriod, type ReportFilters } from "@/lib/operations/filters";
import { downloadCsv } from "@/lib/operations/export-csv";
import { formatDateTime } from "@/lib/utils";
import type { ContentType, SocialPlatform } from "@/lib/types";

interface AccountOption {
  id: string;
  platform: SocialPlatform;
  ig_username: string | null;
}

interface Props {
  audit: PublicationAuditReport;
  filters: ReportFilters;
  accounts: AccountOption[];
  selectedAccountId: string;
}

const REVIEWED_STORAGE_KEY = "postarigr-audit-reviewed";

function loadReviewedIds(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(REVIEWED_STORAGE_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function saveReviewedIds(ids: Set<string>) {
  localStorage.setItem(REVIEWED_STORAGE_KEY, JSON.stringify([...ids]));
}

function MetricCard({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string | number;
  tone?: "default" | "danger" | "success" | "warning";
}) {
  const toneClass =
    tone === "danger"
      ? "text-ig-danger"
      : tone === "success"
        ? "text-emerald-600"
        : tone === "warning"
          ? "text-amber-600"
          : "text-ig-text";

  return (
    <div className="rounded-2xl border border-ig-border bg-ig-elevated p-4">
      <p className="text-xs text-ig-muted">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${toneClass}`}>{value}</p>
    </div>
  );
}

export function PublicationAuditPanel({
  audit,
  filters,
  accounts,
  selectedAccountId,
}: Props) {
  const router = useRouter();
  const [reviewedIds, setReviewedIds] = useState<Set<string>>(new Set());
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setReviewedIds(loadReviewedIds());
  }, []);

  const buildHref = useCallback(
    (patch: Partial<ReportFilters>) =>
      buildReportQuery({
        ...filters,
        ...patch,
        view: "audit",
        accountId: selectedAccountId || undefined,
      }),
    [filters, selectedAccountId],
  );

  const visibleAccounts = accounts.filter(
    (a) => filters.platform === "all" || a.platform === filters.platform,
  );

  const activeDuplicates = useMemo(
    () =>
      audit.rows.filter(
        (row) => row.isDuplicateSuspect && !reviewedIds.has(row.postId),
      ).length,
    [audit.rows, reviewedIds],
  );

  async function runAction(postId: string, action: "retry" | "cancel") {
    setLoadingId(postId);
    setMessage(null);
    try {
      const response = await fetch(`/api/posts/${postId}${action === "retry" ? "/retry" : ""}`, {
        method: action === "retry" ? "POST" : "DELETE",
        credentials: "include",
      });
      const data = await response.json();
      if (!response.ok) throw new Error(String(data.error ?? "Falha na ação"));
      setMessage(action === "retry" ? "Retry solicitado." : "Post removido da fila.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Erro na ação");
    } finally {
      setLoadingId(null);
    }
  }

  function markReviewed(postId: string) {
    const next = new Set(reviewedIds);
    next.add(postId);
    setReviewedIds(next);
    saveReviewedIds(next);
  }

  function exportAudit() {
    const csv = auditRowsToCsv(audit.rows);
    downloadCsv(
      `auditoria-${audit.summary.periodLabel.replace(/\s+/g, "-").toLowerCase()}.csv`,
      csv,
    );
  }

  const { summary } = audit;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-ig-text">Conferência de publicações</h2>
        <p className="mt-1 text-sm text-ig-muted">
          Compare o que foi programado com o que foi publicado — sem alterar nada automaticamente.
        </p>
      </div>

      <section className="rounded-2xl border border-ig-border bg-ig-elevated p-4">
        <form action="/dashboard/reports" method="get" className="space-y-4">
          <input type="hidden" name="view" value="audit" />
          {filters.platform !== "all" && (
            <input type="hidden" name="platform" value={filters.platform} />
          )}

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="block text-xs text-ig-muted">
              Conta
              <select
                name="account"
                defaultValue={selectedAccountId}
                className="ig-input mt-1 w-full text-sm"
              >
                <option value="">Todas as contas</option>
                {visibleAccounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.platform === "tiktok" ? "TT" : "IG"} @
                    {account.ig_username ?? "conta"}
                  </option>
                ))}
              </select>
            </label>

            <label className="block text-xs text-ig-muted">
              Plataforma
              <select name="platform" defaultValue={filters.platform} className="ig-input mt-1 w-full text-sm">
                <option value="all">Todas</option>
                <option value="instagram">Instagram</option>
                <option value="tiktok">TikTok</option>
              </select>
            </label>

            <label className="block text-xs text-ig-muted">
              Tipo de conteúdo
              <select
                name="content_type"
                defaultValue={filters.contentType}
                className="ig-input mt-1 w-full text-sm"
              >
                <option value="all">Todos</option>
                <option value="reel">Reels</option>
                <option value="post">Posts</option>
                <option value="story">Stories</option>
                <option value="tiktok_video">TikTok Videos</option>
              </select>
            </label>

            <label className="block text-xs text-ig-muted">
              Período
              <select
                name="audit_period"
                defaultValue={filters.auditPeriod ?? "today"}
                className="ig-input mt-1 w-full text-sm"
              >
                <option value="today">Hoje</option>
                <option value="yesterday">Ontem</option>
                <option value="last_7_days">Últimos 7 dias</option>
                <option value="last_30_days">Últimos 30 dias</option>
              </select>
            </label>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <label className="block text-xs text-ig-muted">
              Data específica (opcional)
              <input
                type="date"
                name="audit_date"
                defaultValue={filters.auditDate ?? ""}
                className="ig-input mt-1 text-sm"
              />
            </label>
            <button type="submit" className="ig-btn px-4 py-2 text-sm">
              Conferir
            </button>
          </div>
        </form>

        <div className="mt-3 flex flex-wrap gap-2">
          {(
            [
              ["today", "Hoje"],
              ["yesterday", "Ontem"],
              ["last_7_days", "7 dias"],
              ["last_30_days", "30 dias"],
            ] as const
          ).map(([value, label]) => (
            <a
              key={value}
              href={buildHref({ auditPeriod: value as AuditPeriod, auditDate: undefined })}
              className={`rounded-full px-3 py-1 text-xs ${
                (filters.auditPeriod ?? "today") === value && !filters.auditDate
                  ? "bg-ig-primary text-ig-on-primary"
                  : "border border-ig-border hover:bg-ig-secondary"
              }`}
            >
              {label}
            </a>
          ))}
        </div>
      </section>

      <div
        className={`rounded-2xl border p-4 ${auditStatusClass(summary.overallStatus)}`}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide">
              Status da auditoria — {auditStatusLabel(summary.overallStatus)}
            </p>
            <p className="mt-1 text-sm font-medium">{summary.statusMessage}</p>
            <p className="mt-1 text-xs opacity-80">
              {summary.accountLabel} · {summary.periodLabel}
            </p>
          </div>
          <button
            type="button"
            onClick={exportAudit}
            className="rounded-lg border border-current/20 bg-white/50 px-3 py-1.5 text-xs font-medium hover:bg-white/80 dark:bg-black/20"
          >
            Exportar auditoria
          </button>
        </div>
      </div>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <MetricCard label="Programados" value={summary.scheduled} />
        <MetricCard label="Publicados" value={summary.published} tone="success" />
        <MetricCard label="Falhas" value={summary.failed} tone="danger" />
        <MetricCard label="Pendentes" value={summary.pending} tone="warning" />
        <MetricCard
          label="Duplicados suspeitos"
          value={activeDuplicates}
          tone={activeDuplicates > 0 ? "danger" : "default"}
        />
        <MetricCard label="Taxa de conclusão" value={`${summary.completionRate}%`} />
      </section>

      {(summary.extraPublished > 0 ||
        summary.missingPublished > 0 ||
        summary.offScheduleCount > 0) && (
        <section className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
          <p className="font-semibold text-amber-800 dark:text-amber-200">Inconsistências detectadas</p>
          <ul className="mt-2 list-inside list-disc space-y-1 text-amber-900/80 dark:text-amber-100/80">
            {summary.extraPublished > 0 && (
              <li>{summary.extraPublished} publicação(ões) fora do programado no período</li>
            )}
            {summary.missingPublished > 0 && (
              <li>{summary.missingPublished} programado(s) não publicado(s) (vencidos)</li>
            )}
            {summary.offScheduleCount > 0 && (
              <li>{summary.offScheduleCount} publicado(s) fora do horário agendado (&gt;30 min)</li>
            )}
            {summary.processing > 0 && (
              <li>{summary.processing} post(s) preso(s) em publicação</li>
            )}
          </ul>
        </section>
      )}

      {message && <p className="text-sm text-ig-muted">{message}</p>}

      <section className="overflow-x-auto rounded-2xl border border-ig-border">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-ig-secondary text-xs uppercase text-ig-muted">
            <tr>
              <th className="px-4 py-3">Agendado</th>
              <th className="px-4 py-3">Publicado</th>
              <th className="px-4 py-3">Conta</th>
              <th className="px-4 py-3">Plataforma</th>
              <th className="px-4 py-3">Tipo</th>
              <th className="px-4 py-3">Vídeo</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Diferença</th>
              <th className="px-4 py-3">Sinalização</th>
              <th className="px-4 py-3">Ações</th>
            </tr>
          </thead>
          <tbody>
            {audit.rows.map((row) => {
              const reviewed = reviewedIds.has(row.postId);
              const showDuplicate = row.isDuplicateSuspect && !reviewed;

              return (
                <tr
                  key={row.postId}
                  className={`border-t border-ig-border align-top ${
                    showDuplicate ? "bg-ig-danger/5" : row.isPastDue ? "bg-amber-500/5" : ""
                  }`}
                >
                  <td className="px-4 py-3 text-xs">{formatDateTime(row.scheduledAt)}</td>
                  <td className="px-4 py-3 text-xs">
                    {row.publishedAt ? formatDateTime(row.publishedAt) : "—"}
                  </td>
                  <td className="px-4 py-3">@{row.accountUsername}</td>
                  <td className="px-4 py-3 capitalize">{row.platform}</td>
                  <td className="px-4 py-3 text-xs">{row.contentTypeLabel}</td>
                  <td className="max-w-[120px] truncate px-4 py-3 text-xs" title={row.videoLabel}>
                    {row.videoLabel}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={row.status} />
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {row.scheduleDeltaLabel ?? "—"}
                    {row.scheduleDeltaMinutes !== null &&
                      Math.abs(row.scheduleDeltaMinutes) > 30 && (
                        <span className="mt-0.5 block text-amber-600">Fora do horário</span>
                      )}
                  </td>
                  <td className="max-w-xs px-4 py-3 text-xs">
                    {row.errorMessage && (
                      <p className="text-ig-danger">{row.errorMessage}</p>
                    )}
                    {showDuplicate &&
                      row.duplicateFlags.map((flag) => (
                        <p key={flag} className="text-ig-danger">
                          ⚠ {flag}
                        </p>
                      ))}
                    {reviewed && row.isDuplicateSuspect && (
                      <p className="text-ig-muted">Duplicado revisado</p>
                    )}
                    {row.isPastDue && (
                      <p className="text-amber-600">Pendente vencido</p>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex min-w-[140px] flex-col gap-1">
                      <Link
                        href={`/dashboard/posts/${row.postId}`}
                        className="text-xs text-ig-primary hover:underline"
                      >
                        Detalhes
                      </Link>
                      {row.permalink && (
                        <a
                          href={row.permalink}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-ig-primary hover:underline"
                        >
                          Abrir publicação
                        </a>
                      )}
                      {(row.status === "failed" ||
                        row.status === "failed_persistent" ||
                        row.status === "retrying") && (
                        <button
                          type="button"
                          disabled={loadingId === row.postId}
                          onClick={() => void runAction(row.postId, "retry")}
                          className="text-left text-xs text-ig-text hover:underline disabled:opacity-50"
                        >
                          Tentar novamente
                        </button>
                      )}
                      {(row.status === "pending" || row.status === "retrying") && (
                        <>
                          <Link
                            href={`/dashboard/posts/${row.postId}`}
                            className="text-xs hover:underline"
                          >
                            Reagendar
                          </Link>
                          <button
                            type="button"
                            disabled={loadingId === row.postId}
                            onClick={() => void runAction(row.postId, "cancel")}
                            className="text-left text-xs text-ig-danger hover:underline disabled:opacity-50"
                          >
                            Cancelar
                          </button>
                        </>
                      )}
                      {row.isDuplicateSuspect && !reviewed && (
                        <button
                          type="button"
                          onClick={() => markReviewed(row.postId)}
                          className="text-left text-xs text-ig-muted hover:underline"
                        >
                          Marcar revisado
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!audit.rows.length && (
          <p className="px-4 py-12 text-center text-sm text-ig-muted">
            Nenhum post programado neste período para os filtros selecionados.
          </p>
        )}
      </section>
    </div>
  );
}
