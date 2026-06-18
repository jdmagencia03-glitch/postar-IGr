"use client";

import { formatShortDateTime } from "@/lib/operations/compute";
import type { PlatformMetrics, ContentTypeMetricsRow, MultiplatformGroupMetrics } from "@/lib/operations/metrics";

interface Props {
  platformMetrics: PlatformMetrics[];
  contentTypeMetrics: ContentTypeMetricsRow[];
  multiplatformMetrics: MultiplatformGroupMetrics;
}

function StatRow({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-center justify-between gap-2 text-sm">
      <span className="text-ig-muted">{label}</span>
      <span className="font-semibold text-ig-text">{value}</span>
    </div>
  );
}

export function MetricsPanels({
  platformMetrics,
  contentTypeMetrics,
  multiplatformMetrics,
}: Props) {
  const instagram = platformMetrics.find((p) => p.platform === "instagram");
  const tiktok = platformMetrics.find((p) => p.platform === "tiktok");

  return (
    <div className="space-y-6">
      <section className="grid gap-4 lg:grid-cols-2">
        {instagram && (
          <div className="rounded-2xl border border-ig-border bg-ig-elevated p-5">
            <h3 className="text-base font-bold text-ig-text">Instagram</h3>
            <div className="mt-4 space-y-2">
              <StatRow label="Reels publicados" value={instagram.reels ?? 0} />
              <StatRow label="Stories publicados" value={instagram.stories ?? 0} />
              <StatRow label="Posts publicados" value={instagram.posts ?? 0} />
              <StatRow label="Pendentes" value={instagram.pending} />
              <StatRow label="Falhas" value={instagram.failed} />
              <StatRow label="Taxa de sucesso" value={`${instagram.successRate}%`} />
            </div>
          </div>
        )}

        {tiktok && (
          <div className="rounded-2xl border border-ig-border bg-ig-elevated p-5">
            <h3 className="text-base font-bold text-ig-text">TikTok</h3>
            <div className="mt-4 space-y-2">
              <StatRow label="Vídeos publicados" value={tiktok.videos ?? tiktok.published} />
              <StatRow label="Pendentes" value={tiktok.pending} />
              <StatRow label="Falhas" value={tiktok.failed} />
              <StatRow label="Em retry" value={tiktok.retrying} />
              <StatRow label="Taxa de sucesso" value={`${tiktok.successRate}%`} />
            </div>
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-ig-border bg-ig-elevated p-5">
        <h3 className="text-base font-bold text-ig-text">Multiplataforma</h3>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <StatRow label="Grupos" value={multiplatformMetrics.totalGroups} />
          <StatRow label="Completos" value={multiplatformMetrics.completeGroups} />
          <StatRow label="Parciais" value={multiplatformMetrics.partialGroups} />
          <StatRow label="Com erro" value={multiplatformMetrics.errorGroups} />
          <StatRow label="Em retry" value={multiplatformMetrics.retryGroups} />
          <StatRow label="Pendentes" value={multiplatformMetrics.pendingGroups} />
        </div>
      </section>

      <section>
        <h3 className="mb-3 text-base font-bold text-ig-text">Por tipo de conteúdo</h3>
        <div className="overflow-x-auto rounded-2xl border border-ig-border">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-ig-secondary text-xs uppercase text-ig-muted">
              <tr>
                <th className="px-4 py-3">Tipo</th>
                <th className="px-4 py-3">Publicados</th>
                <th className="px-4 py-3">Pendentes</th>
                <th className="px-4 py-3">Falhas</th>
                <th className="px-4 py-3">Retry</th>
                <th className="px-4 py-3">Sucesso</th>
                <th className="px-4 py-3">Próxima</th>
              </tr>
            </thead>
            <tbody>
              {contentTypeMetrics.map((row) => (
                <tr key={row.contentType} className="border-t border-ig-border">
                  <td className="px-4 py-3 font-medium">{row.label}</td>
                  <td className="px-4 py-3">{row.published}</td>
                  <td className="px-4 py-3">{row.pending}</td>
                  <td className="px-4 py-3">{row.failed}</td>
                  <td className="px-4 py-3">{row.retrying}</td>
                  <td className="px-4 py-3">{row.successRate}%</td>
                  <td className="px-4 py-3 text-xs text-ig-muted">
                    {row.nextScheduled ? formatShortDateTime(row.nextScheduled) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
