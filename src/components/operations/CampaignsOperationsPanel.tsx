"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CAMPAIGN_OBJECTIVE_LABELS } from "@/lib/campaigns/campaigns";
import type { CampaignOperationsRow } from "@/lib/campaigns/operations-stats";

interface Props {
  rows: CampaignOperationsRow[];
}

export function CampaignsOperationsPanel({ rows }: Props) {
  const router = useRouter();
  const [loadingId, setLoadingId] = useState<string | null>(null);

  if (!rows.length) return null;

  async function toggleCampaign(id: string, status: "active" | "paused") {
    setLoadingId(id);
    try {
      const res = await fetch(`/api/campaigns/${id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(String(data.error ?? "Falha"));
      }
      router.refresh();
    } finally {
      setLoadingId(null);
    }
  }

  return (
    <section>
      <div className="mb-4">
        <h2 className="text-xl font-bold text-ig-text">Campanhas ativas</h2>
        <p className="text-sm text-ig-muted">
          Operações de venda em andamento nas suas páginas.
        </p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {rows.map(({ campaign, scheduledPosts, scheduledStories, publishedToday, failedCount }) => {
          const productName =
            (campaign.products as { name?: string } | null)?.name ?? "—";
          const accountCount = campaign.campaign_accounts?.length ?? 0;

          return (
            <article
              key={campaign.id}
              className="rounded-2xl border border-ig-border bg-ig-elevated p-5"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold text-ig-text">{campaign.name}</h3>
                  <p className="text-sm text-ig-muted">
                    {productName} ·{" "}
                    {CAMPAIGN_OBJECTIVE_LABELS[campaign.objective] ?? campaign.objective}
                  </p>
                </div>
                <span className="rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                  Ativa
                </span>
              </div>

              <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                <div>
                  <dt className="text-ig-muted">Páginas</dt>
                  <dd className="font-semibold">{accountCount}</dd>
                </div>
                <div>
                  <dt className="text-ig-muted">Posts prog.</dt>
                  <dd className="font-semibold">{scheduledPosts}</dd>
                </div>
                <div>
                  <dt className="text-ig-muted">Stories prog.</dt>
                  <dd className="font-semibold">{scheduledStories}</dd>
                </div>
                <div>
                  <dt className="text-ig-muted">Hoje</dt>
                  <dd className="font-semibold">{publishedToday}</dd>
                </div>
              </dl>

              {failedCount > 0 && (
                <p className="mt-2 text-xs text-ig-danger">{failedCount} falha(s) na campanha</p>
              )}

              {campaign.default_cta && (
                <p className="mt-2 text-xs text-ig-muted">
                  CTA: <span className="font-medium text-ig-text">{campaign.default_cta}</span>
                </p>
              )}

              <div className="mt-4 flex flex-wrap gap-2">
                <Link
                  href={`/dashboard/campaigns?id=${campaign.id}`}
                  className="rounded-lg border border-ig-border px-3 py-1.5 text-xs font-medium hover:bg-ig-secondary"
                >
                  Ver campanha
                </Link>
                <Link
                  href="/dashboard/bulk"
                  className="rounded-lg border border-ig-border px-3 py-1.5 text-xs font-medium hover:bg-ig-secondary"
                >
                  Agendar conteúdo
                </Link>
                {campaign.product_id && (
                  <Link
                    href={`/dashboard/products?id=${campaign.product_id}`}
                    className="rounded-lg border border-ig-border px-3 py-1.5 text-xs font-medium hover:bg-ig-secondary"
                  >
                    Abrir produto
                  </Link>
                )}
                <button
                  type="button"
                  disabled={loadingId === campaign.id}
                  onClick={() => void toggleCampaign(campaign.id, "paused")}
                  className="rounded-lg border border-ig-border px-3 py-1.5 text-xs disabled:opacity-50"
                >
                  Pausar
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
