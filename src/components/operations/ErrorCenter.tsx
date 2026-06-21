"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { RefreshCw } from "lucide-react";
import { AccountFilterBar } from "@/components/AccountFilterBar";
import {
  buildLogsHref,
  ERROR_CATEGORY_LABELS,
  ERROR_SEVERITY_LABELS,
  ERROR_STATUS_LABELS,
} from "@/lib/operations/operational-errors";
import { formatDateTime } from "@/lib/utils";
import type { OwnerAccountRef } from "@/lib/posts";
import type {
  OperationalError,
  OperationalErrorCategory,
  OperationalErrorSeverity,
  OperationalErrorStatus,
  OperationalErrorSummary,
  SocialPlatform,
} from "@/lib/types";
import { cn } from "@/lib/utils";

interface Props {
  errors: OperationalError[];
  summary: OperationalErrorSummary;
  globalSummary: OperationalErrorSummary;
  syncedAt: string;
  accounts: OwnerAccountRef[];
  filters: {
    severity?: string;
    status?: string;
    category?: string;
    accountId?: string;
    platform?: SocialPlatform | "all";
    q?: string;
  };
}

const CATEGORY_FILTERS: Array<{ id: OperationalErrorCategory | "all"; label: string }> = [
  { id: "all", label: "Todos" },
  { id: "upload", label: "Upload" },
  { id: "scheduling", label: "Agendamento" },
  { id: "publishing", label: "Publicação" },
  { id: "account", label: "Conta" },
  { id: "ai", label: "IA" },
  { id: "system", label: "Sistema" },
];

const STATUS_FILTERS: Array<{ id: OperationalErrorStatus | "all" | "open_active"; label: string }> = [
  { id: "open_active", label: "Abertos" },
  { id: "needs_user_action", label: "Precisa de ação" },
  { id: "auto_retrying", label: "Tentando corrigir" },
  { id: "resolved", label: "Resolvidos" },
  { id: "ignored", label: "Ignorados" },
  { id: "all", label: "Todos" },
];

function severityClass(severity: OperationalErrorSeverity) {
  if (severity === "critical") return "border-ig-danger/40 bg-ig-danger/10 text-ig-danger";
  if (severity === "high") return "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300";
  if (severity === "medium") return "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300";
  return "border-ig-border bg-ig-secondary text-ig-muted";
}

function statusClass(status: OperationalErrorStatus) {
  if (status === "needs_user_action") return "bg-ig-danger/15 text-ig-danger";
  if (status === "auto_retrying") return "bg-sky-500/15 text-sky-700 dark:text-sky-300";
  if (status === "resolved") return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300";
  if (status === "ignored") return "bg-ig-secondary text-ig-muted";
  return "bg-amber-500/15 text-amber-700 dark:text-amber-300";
}

function FilterChip({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "rounded-full px-3 py-1.5 text-xs font-medium transition",
        active ? "bg-ig-primary text-white" : "border border-ig-border bg-ig-elevated text-ig-muted hover:text-ig-text",
      )}
    >
      {children}
    </Link>
  );
}

function buildFilterHref(
  basePath: string,
  current: Props["filters"],
  patch: Partial<Props["filters"]>,
) {
  const next = { ...current, ...patch };
  const params = new URLSearchParams();
  if (next.severity && next.severity !== "all") params.set("severity", next.severity);
  if (next.status && next.status !== "open_active") params.set("status", next.status);
  if (next.category && next.category !== "all") params.set("category", next.category);
  if (next.accountId) params.set("account", next.accountId);
  if (next.platform && next.platform !== "all") params.set("platform", next.platform);
  if (next.q) params.set("q", next.q);
  const qs = params.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}

function SummaryCard({ label, value, tone }: { label: string; value: number; tone?: "danger" | "warning" | "ok" }) {
  return (
    <div className="rounded-2xl border border-ig-border bg-ig-elevated p-4">
      <p className="text-xs text-ig-muted">{label}</p>
      <p
        className={cn(
          "mt-1 text-2xl font-bold",
          tone === "danger" && "text-ig-danger",
          tone === "warning" && "text-amber-600",
          tone === "ok" && "text-emerald-600",
          !tone && "text-ig-text",
        )}
      >
        {value}
      </p>
    </div>
  );
}

function ErrorCard({
  error,
  onAction,
  busy,
}: {
  error: OperationalError;
  onAction: (errorId: string, action: string, href?: string) => void;
  busy: boolean;
}) {
  const batchNumber = error.metadata.batchNumber as number | undefined;
  const filename = error.metadata.filename as string | undefined;

  return (
    <article className="rounded-2xl border border-ig-border bg-ig-elevated p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn("rounded-full border px-2.5 py-0.5 text-xs font-semibold", severityClass(error.severity))}>
              {ERROR_SEVERITY_LABELS[error.severity]}
            </span>
            <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-medium", statusClass(error.status))}>
              {ERROR_STATUS_LABELS[error.status]}
            </span>
            <span className="rounded-full bg-ig-secondary px-2.5 py-0.5 text-xs text-ig-muted">
              {ERROR_CATEGORY_LABELS[error.category]}
            </span>
          </div>
          <h3 className="text-base font-semibold text-ig-text">{error.title}</h3>
          <p className="text-sm text-ig-muted">{error.message}</p>
        </div>
        <div className="text-right text-xs text-ig-muted">
          <p>{formatDateTime(error.last_seen_at)}</p>
          {error.retry_count > 0 && <p className="mt-1">{error.retry_count} ocorrência(s)</p>}
        </div>
      </div>

      <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
        {error.probable_cause && (
          <div>
            <dt className="text-xs font-medium text-ig-muted">Causa provável</dt>
            <dd className="text-ig-text">{error.probable_cause}</dd>
          </div>
        )}
        {error.recommended_action && (
          <div>
            <dt className="text-xs font-medium text-ig-muted">Ação recomendada</dt>
            <dd className="text-ig-text">{error.recommended_action}</dd>
          </div>
        )}
        {error.technical_message && (
          <div className="sm:col-span-2">
            <dt className="text-xs font-medium text-ig-muted">Detalhe técnico</dt>
            <dd className="font-mono text-xs text-ig-danger">{error.technical_message}</dd>
          </div>
        )}
      </dl>

      <div className="mt-4 flex flex-wrap gap-2 text-xs text-ig-muted">
        {error.platform && <span className="capitalize">Plataforma: {error.platform}</span>}
        {error.upload_batch_id && (
          <span>
            Lote: {batchNumber ? `#${batchNumber}` : error.upload_batch_id.slice(0, 8)}
          </span>
        )}
        {filename && <span>Arquivo: {filename}</span>}
        {error.scheduled_post_id && <span>Post: {error.scheduled_post_id.slice(0, 8)}</span>}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {error.available_actions.map((action) => (
          <button
            key={`${error.id}-${action.type}`}
            type="button"
            disabled={busy}
            onClick={() => onAction(error.id, action.type, action.href)}
            className="rounded-lg border border-ig-border px-3 py-1.5 text-xs font-medium hover:bg-ig-secondary disabled:opacity-50"
          >
            {action.label}
          </button>
        ))}
        <Link
          href={buildLogsHref(error)}
          className="rounded-lg border border-ig-primary/30 px-3 py-1.5 text-xs font-medium text-ig-primary hover:bg-ig-primary/10"
        >
          Ver logs relacionados
        </Link>
        {!error.id.startsWith("detected-") && (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => onAction(error.id, "__resolve__")}
              className="rounded-lg border border-emerald-500/30 px-3 py-1.5 text-xs text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-300"
            >
              Marcar resolvido
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => onAction(error.id, "__ignore__")}
              className="rounded-lg border border-ig-border px-3 py-1.5 text-xs text-ig-muted hover:bg-ig-secondary"
            >
              Ignorar
            </button>
          </>
        )}
      </div>
    </article>
  );
}

export function ErrorCenter({ errors, summary, globalSummary, syncedAt, accounts, filters }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [search, setSearch] = useState(filters.q ?? "");

  const basePath = "/dashboard/errors";
  const hasAccountFilter = Boolean(filters.accountId);
  const hasPlatformFilter = Boolean(filters.platform && filters.platform !== "all");
  const hasScopeFilter = hasAccountFilter || hasPlatformFilter;
  const displaySummary = hasScopeFilter ? globalSummary : summary;
  const filteredListSummary = hasScopeFilter ? summary : null;

  const visibleErrors = useMemo(() => {
    if (!filters.severity || filters.severity === "all") return errors;
    return errors.filter((e) => e.severity === filters.severity);
  }, [errors, filters.severity]);

  async function handleAction(errorId: string, action: string, href?: string) {
    if (action === "__resolve__") {
      await fetch(`/api/operations/errors/${errorId}/resolve`, { method: "POST", credentials: "include" });
      startTransition(() => router.refresh());
      return;
    }
    if (action === "__ignore__") {
      await fetch(`/api/operations/errors/${errorId}/ignore`, { method: "POST", credentials: "include" });
      startTransition(() => router.refresh());
      return;
    }
    if (href?.startsWith("/api/")) {
      await fetch(href, { credentials: "include" });
      startTransition(() => router.refresh());
      return;
    }
    if (href) {
      if (href.startsWith("http") || href.startsWith("/api/")) {
        window.location.href = href;
      } else {
        router.push(href);
      }
      return;
    }
    await fetch(`/api/operations/errors/${errorId}/action`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    startTransition(() => router.refresh());
  }

  function handleSearchSubmit(event: React.FormEvent) {
    event.preventDefault();
    router.push(buildFilterHref(basePath, filters, { q: search || undefined }));
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-ig-text">Central de Erros</h1>
          <p className="mt-1 max-w-2xl text-sm text-ig-muted">
            Problemas importantes de upload, publicação, contas e sistema — com causa provável e ações rápidas.
          </p>
          <p className="mt-1 text-xs text-ig-muted">Atualizado: {formatDateTime(syncedAt)}</p>
        </div>
        <button
          type="button"
          disabled={pending}
          onClick={() => startTransition(() => router.refresh())}
          className="inline-flex items-center gap-2 rounded-xl border border-ig-border px-4 py-2 text-sm hover:bg-ig-secondary"
        >
          <RefreshCw className={cn("h-4 w-4", pending && "animate-spin")} />
          Atualizar
        </button>
      </div>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <SummaryCard label="Erros críticos" value={displaySummary.critical} tone="danger" />
        <SummaryCard label="Uploads travados" value={displaySummary.stalledUploads} tone="warning" />
        <SummaryCard label="Publicações com falha" value={displaySummary.failedPublications} tone="danger" />
        <SummaryCard label="Contas com problema" value={displaySummary.accountsWithProblems} tone="warning" />
        <SummaryCard label="Resolvidos hoje" value={displaySummary.resolvedToday} tone="ok" />
        <SummaryCard label="Tentativas automáticas" value={displaySummary.autoRetrying} />
      </section>

      {hasScopeFilter && filteredListSummary && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-200">
          <p className="font-medium">Filtro ativo — totais acima são de todas as contas do workspace.</p>
          <p className="mt-1 text-xs opacity-90">
            Lista filtrada: {filteredListSummary.critical} críticos · {filteredListSummary.failedPublications}{" "}
            publicações com falha · {visibleErrors.length} item(ns) visíveis
            {hasAccountFilter && filters.accountId ? ` · conta ${filters.accountId.slice(0, 8)}` : ""}
            {hasPlatformFilter ? ` · ${filters.platform}` : ""}
          </p>
          <Link href={basePath} className="mt-2 inline-block text-xs font-medium underline">
            Ver todas as contas
          </Link>
        </div>
      )}

      <AccountFilterBar
        accounts={accounts}
        selectedAccountId={filters.accountId}
        selectedPlatform={filters.platform ?? "all"}
        basePath={basePath}
        extraParams={{
          severity: filters.severity !== "all" ? filters.severity : undefined,
          status: filters.status !== "open_active" ? filters.status : undefined,
          category: filters.category !== "all" ? filters.category : undefined,
          q: filters.q,
        }}
      />

      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <FilterChip href={buildFilterHref(basePath, filters, { severity: "critical" })} active={filters.severity === "critical"}>
            Críticos
          </FilterChip>
          {CATEGORY_FILTERS.map((item) => (
            <FilterChip
              key={item.id}
              href={buildFilterHref(basePath, filters, { category: item.id })}
              active={(filters.category ?? "all") === item.id}
            >
              {item.label}
            </FilterChip>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {STATUS_FILTERS.map((item) => (
            <FilterChip
              key={item.id}
              href={buildFilterHref(basePath, filters, { status: item.id })}
              active={(filters.status ?? "open_active") === item.id}
            >
              {item.label}
            </FilterChip>
          ))}
        </div>
        <form onSubmit={handleSearchSubmit} className="flex gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar erro..."
            className="w-full max-w-md rounded-xl border border-ig-border bg-ig-elevated px-4 py-2 text-sm"
          />
          <button type="submit" className="rounded-xl border border-ig-border px-4 py-2 text-sm hover:bg-ig-secondary">
            Buscar
          </button>
        </form>
      </div>

      {visibleErrors.length === 0 ? (
        <div className="rounded-2xl border border-ig-border bg-ig-elevated p-10 text-center">
          <p className="text-lg font-semibold text-ig-text">Nenhum erro crítico no momento</p>
          <p className="mt-2 text-sm text-ig-muted">
            Quando uploads, publicações ou contas apresentarem problemas, eles aparecerão aqui.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {visibleErrors.map((error) => (
            <ErrorCard key={error.id} error={error} onAction={handleAction} busy={pending} />
          ))}
        </div>
      )}
    </div>
  );
}
