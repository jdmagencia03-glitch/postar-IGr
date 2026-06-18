"use client";

import { useEffect, useMemo, useState } from "react";
import { CAMPAIGN_OBJECTIVE_LABELS } from "@/lib/campaigns/campaigns";
import type { Campaign, CampaignObjective, Product } from "@/lib/types";

export interface ProductCampaignSelection {
  productId: string | null;
  campaignId: string | null;
  contentObjective: string | null;
}

interface Props {
  value: ProductCampaignSelection;
  onChange: (value: ProductCampaignSelection) => void;
  compact?: boolean;
}

export function ProductCampaignSelector({ value, onChange, compact = false }: Props) {
  const [products, setProducts] = useState<Product[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/api/products?status=active", { credentials: "include" }).then((r) => r.json()),
      fetch("/api/campaigns?status=active", { credentials: "include" }).then((r) => r.json()),
    ])
      .then(([productsData, campaignsData]) => {
        setProducts((productsData.products as Product[]) ?? []);
        setCampaigns((campaignsData.campaigns as Campaign[]) ?? []);
      })
      .catch(() => {
        setProducts([]);
        setCampaigns([]);
      })
      .finally(() => setLoading(false));
  }, []);

  const selectedCampaign = useMemo(
    () => campaigns.find((c) => c.id === value.campaignId) ?? null,
    [campaigns, value.campaignId],
  );

  const selectedProduct = useMemo(() => {
    if (value.productId) {
      return products.find((p) => p.id === value.productId) ?? null;
    }
    if (selectedCampaign?.product_id && selectedCampaign.products) {
      return selectedCampaign.products as unknown as Product;
    }
    return null;
  }, [products, value.productId, selectedCampaign]);

  function handleCampaignChange(campaignId: string) {
    if (!campaignId) {
      onChange({ ...value, campaignId: null });
      return;
    }
    const campaign = campaigns.find((c) => c.id === campaignId);
    onChange({
      productId: campaign?.product_id ?? value.productId,
      campaignId,
      contentObjective:
        value.contentObjective ??
        (campaign?.objective
          ? CAMPAIGN_OBJECTIVE_LABELS[campaign.objective as CampaignObjective]
          : null),
    });
  }

  const objectiveOptions = Object.entries(CAMPAIGN_OBJECTIVE_LABELS);

  if (loading) {
    return <p className="text-xs text-ig-muted">Carregando produtos e campanhas…</p>;
  }

  if (!products.length && !campaigns.length) {
    return (
      <p className="text-xs text-ig-muted">
        Nenhum produto ou campanha cadastrado.{" "}
        <a href="/dashboard/products" className="text-ig-primary hover:underline">
          Cadastrar produto
        </a>
      </p>
    );
  }

  return (
    <div className={`space-y-3 ${compact ? "" : "rounded-xl border border-ig-border bg-ig-secondary p-4"}`}>
      {!compact && (
        <div>
          <p className="text-sm font-semibold text-ig-text">Produto / Campanha</p>
          <p className="text-xs text-ig-muted">
            Opcional — a IA adaptará legendas e CTAs com foco em conversão.
          </p>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-xs">
          <span className="font-medium text-ig-muted">Produto</span>
          <select
            value={value.productId ?? ""}
            onChange={(e) =>
              onChange({ ...value, productId: e.target.value || null })
            }
            className="ig-input mt-1 w-full text-sm"
          >
            <option value="">Nenhum</option>
            {products.map((product) => (
              <option key={product.id} value={product.id}>
                {product.name}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-xs">
          <span className="font-medium text-ig-muted">Campanha</span>
          <select
            value={value.campaignId ?? ""}
            onChange={(e) => handleCampaignChange(e.target.value)}
            className="ig-input mt-1 w-full text-sm"
          >
            <option value="">Nenhuma</option>
            {campaigns.map((campaign) => (
              <option key={campaign.id} value={campaign.id}>
                {campaign.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="block text-xs">
        <span className="font-medium text-ig-muted">Objetivo do conteúdo</span>
        <select
          value={value.contentObjective ?? ""}
          onChange={(e) =>
            onChange({ ...value, contentObjective: e.target.value || null })
          }
          className="ig-input mt-1 w-full text-sm"
        >
          <option value="">Automático (playbook)</option>
          {objectiveOptions.map(([key, label]) => (
            <option key={key} value={label}>
              {label}
            </option>
          ))}
        </select>
      </label>

      {selectedProduct && (
        <div className="rounded-lg border border-ig-border bg-ig-elevated p-3 text-xs text-ig-muted">
          <p>
            <span className="font-medium text-ig-text">CTA:</span>{" "}
            {selectedCampaign?.default_cta ?? selectedProduct.main_cta ?? "—"}
          </p>
          {(selectedCampaign?.comment_keyword ?? selectedProduct.comment_keyword) && (
            <p className="mt-1">
              <span className="font-medium text-ig-text">Palavra-chave:</span>{" "}
              {selectedCampaign?.comment_keyword ?? selectedProduct.comment_keyword}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
