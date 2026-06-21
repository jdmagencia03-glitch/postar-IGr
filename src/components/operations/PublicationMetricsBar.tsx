"use client";

import { formatShortDateTime } from "@/lib/operations/compute";
import type { PublicationMetrics } from "@/lib/operations/metrics";
import { CONTENT_TYPE_LABELS } from "@/lib/content-types";
import type { ContentType } from "@/lib/types";

interface Props {
  metrics: PublicationMetrics;
  scopeFiltered?: boolean;
  filteredMetrics?: PublicationMetrics;
}

function MetricTile({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "danger" | "success" }) {
  const toneClass =
    tone === "danger"
      ? "text-ig-danger"
      : tone === "success"
        ? "text-emerald-600"
        : "text-ig-text";

  return (
    <div className="rounded-2xl border border-ig-border bg-ig-elevated p-4">
      <p className="text-xs text-ig-muted">{label}</p>
      <p className={`mt-1 text-xl font-bold ${toneClass}`}>{value}</p>
    </div>
  );
}

export function PublicationMetricsBar({ metrics, scopeFiltered, filteredMetrics }: Props) {
  const igTotal = metrics.totalByPlatform.instagram ?? 0;
  const ttTotal = metrics.totalByPlatform.tiktok ?? 0;

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-bold text-ig-text">Relatório de publicações</h2>
        <p className="text-sm text-ig-muted">
          Visão operacional consolidada de todas as contas do workspace.
        </p>
        {scopeFiltered && filteredMetrics && (
          <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
            Filtro ativo na lista — métricas acima são globais ({filteredMetrics.failed} falhas na
            seleção atual).
          </p>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
        <MetricTile label="Publicados hoje" value={String(metrics.publishedToday)} tone="success" />
        <MetricTile label="Pendentes" value={String(metrics.pending)} />
        <MetricTile label="Com falha" value={String(metrics.failed)} tone="danger" />
        <MetricTile label="Em retry" value={String(metrics.retrying)} />
        <MetricTile label="Cancelados" value={String(metrics.cancelled)} />
        <MetricTile label="Taxa de sucesso" value={`${metrics.successRate}%`} tone="success" />
        <MetricTile label="Taxa de erro" value={`${metrics.errorRate}%`} tone="danger" />
        <MetricTile label="Instagram" value={String(igTotal)} />
        <MetricTile label="TikTok" value={String(ttTotal)} />
        <MetricTile
          label="Próxima publicação"
          value={metrics.nextScheduled ? formatShortDateTime(metrics.nextScheduled.scheduled_at) : "—"}
        />
        <MetricTile
          label="Última publicação"
          value={
            metrics.lastPublished?.published_at
              ? formatShortDateTime(metrics.lastPublished.published_at)
              : "—"
          }
        />
        <MetricTile
          label="Último erro"
          value={metrics.lastError ? formatShortDateTime(metrics.lastError.at) : "—"}
          tone={metrics.lastError ? "danger" : "default"}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        {Object.entries(metrics.totalByContentType).map(([type, count]) => (
          <span
            key={type}
            className="rounded-full border border-ig-border bg-ig-secondary px-3 py-1 text-xs text-ig-text"
          >
            {CONTENT_TYPE_LABELS[type as ContentType] ?? type}: {count}
          </span>
        ))}
      </div>
    </section>
  );
}
