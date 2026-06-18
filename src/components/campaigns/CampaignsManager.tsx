"use client";

import { useCallback, useEffect, useState } from "react";
import { Pause, Pencil, Play, Plus, Trash2 } from "lucide-react";
import { CAMPAIGN_OBJECTIVE_LABELS } from "@/lib/campaigns/campaigns";
import type { Campaign, CampaignObjective, CampaignStatus, SocialPlatform } from "@/lib/types";

const OBJECTIVES = Object.keys(CAMPAIGN_OBJECTIVE_LABELS) as CampaignObjective[];

const emptyForm = {
  name: "",
  product_id: "",
  niche: "",
  objective: "sell_product" as CampaignObjective,
  default_cta: "",
  comment_keyword: "",
  dm_message: "",
  main_link: "",
  posts_per_day: "15",
  stories_per_day: "4",
  starts_at: "",
  ends_at: "",
  notes: "",
  status: "active" as CampaignStatus,
};

interface AccountOption {
  id: string;
  platform: SocialPlatform;
  label: string;
}

export function CampaignsManager({
  initialId,
  productFilter,
  accountOptions = [],
}: {
  initialId?: string;
  productFilter?: string;
  accountOptions?: AccountOption[];
}) {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [products, setProducts] = useState<Array<{ id: string; name: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(initialId ?? null);
  const [form, setForm] = useState(emptyForm);
  const [selectedAccounts, setSelectedAccounts] = useState<string[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [campaignsRes, productsRes] = await Promise.all([
        fetch("/api/campaigns", { credentials: "include" }),
        fetch("/api/products", { credentials: "include" }),
      ]);
      const campaignsData = await campaignsRes.json();
      const productsData = await productsRes.json();
      setCampaigns((campaignsData.campaigns as Campaign[]) ?? []);
      setProducts(
        ((productsData.products as Array<{ id: string; name: string }>) ?? []).map((p) => ({
          id: p.id,
          name: p.name,
        })),
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (productFilter) {
      setForm((f) => ({ ...f, product_id: productFilter }));
    }
  }, [productFilter]);

  useEffect(() => {
    if (initialId && campaigns.length) {
      const campaign = campaigns.find((c) => c.id === initialId);
      if (campaign) openEdit(campaign);
    }
  }, [initialId, campaigns]);

  function openCreate() {
    setEditingId(null);
    setForm({ ...emptyForm, product_id: productFilter ?? "" });
    setSelectedAccounts([]);
    setShowForm(true);
  }

  function openEdit(campaign: Campaign) {
    setEditingId(campaign.id);
    setForm({
      name: campaign.name,
      product_id: campaign.product_id ?? "",
      niche: campaign.niche ?? "",
      objective: campaign.objective,
      default_cta: campaign.default_cta ?? "",
      comment_keyword: campaign.comment_keyword ?? "",
      dm_message: campaign.dm_message ?? "",
      main_link: campaign.main_link ?? "",
      posts_per_day: String(campaign.posts_per_day),
      stories_per_day: String(campaign.stories_per_day),
      starts_at: campaign.starts_at?.slice(0, 10) ?? "",
      ends_at: campaign.ends_at?.slice(0, 10) ?? "",
      notes: campaign.notes ?? "",
      status: campaign.status,
    });
    setSelectedAccounts(
      (campaign.campaign_accounts ?? []).map((a) => `${a.platform}:${a.account_id}`),
    );
    setShowForm(true);
  }

  async function save() {
    if (!form.name.trim()) {
      setMessage("Nome é obrigatório");
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const accounts = selectedAccounts.map((key) => {
        const [platform, account_id] = key.split(":");
        return { platform: platform as SocialPlatform, account_id };
      });
      const url = editingId ? `/api/campaigns/${editingId}` : "/api/campaigns";
      const res = await fetch(url, {
        method: editingId ? "PATCH" : "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, accounts }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(String(data.error ?? "Falha ao salvar"));
      setShowForm(false);
      await load();
      setMessage(editingId ? "Campanha atualizada" : "Campanha criada");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Erro");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    if (!window.confirm("Excluir esta campanha?")) return;
    const res = await fetch(`/api/campaigns/${id}`, { method: "DELETE", credentials: "include" });
    if (res.ok) await load();
  }

  async function toggleStatus(campaign: Campaign) {
    const next = campaign.status === "active" ? "paused" : "active";
    const res = await fetch(`/api/campaigns/${campaign.id}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    if (res.ok) await load();
  }

  function toggleAccount(key: string) {
    setSelectedAccounts((current) =>
      current.includes(key) ? current.filter((x) => x !== key) : [...current, key],
    );
  }

  const visibleCampaigns = productFilter
    ? campaigns.filter((c) => c.product_id === productFilter)
    : campaigns;

  if (loading) return <p className="text-sm text-ig-muted">Carregando campanhas…</p>;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ig-muted">{visibleCampaigns.length} campanha(s)</p>
        <button type="button" onClick={openCreate} className="ig-btn inline-flex items-center gap-2 px-4 py-2 text-sm">
          <Plus className="h-4 w-4" /> Nova campanha
        </button>
      </div>

      {message && <p className="text-sm text-ig-muted">{message}</p>}

      {showForm && (
        <section className="rounded-2xl border border-ig-border bg-ig-elevated p-5">
          <h2 className="text-lg font-semibold">{editingId ? "Editar campanha" : "Nova campanha"}</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="text-xs sm:col-span-2">
              <span className="font-medium text-ig-muted">Nome *</span>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="ig-input mt-1 w-full text-sm" />
            </label>
            <label className="text-xs">
              <span className="font-medium text-ig-muted">Produto</span>
              <select value={form.product_id} onChange={(e) => setForm({ ...form, product_id: e.target.value })} className="ig-input mt-1 w-full text-sm">
                <option value="">Nenhum</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </label>
            <label className="text-xs">
              <span className="font-medium text-ig-muted">Objetivo</span>
              <select value={form.objective} onChange={(e) => setForm({ ...form, objective: e.target.value as CampaignObjective })} className="ig-input mt-1 w-full text-sm">
                {OBJECTIVES.map((key) => (
                  <option key={key} value={key}>{CAMPAIGN_OBJECTIVE_LABELS[key]}</option>
                ))}
              </select>
            </label>
            <label className="text-xs">
              <span className="font-medium text-ig-muted">Posts/dia</span>
              <input type="number" value={form.posts_per_day} onChange={(e) => setForm({ ...form, posts_per_day: e.target.value })} className="ig-input mt-1 w-full text-sm" />
            </label>
            <label className="text-xs">
              <span className="font-medium text-ig-muted">Stories/dia</span>
              <input type="number" value={form.stories_per_day} onChange={(e) => setForm({ ...form, stories_per_day: e.target.value })} className="ig-input mt-1 w-full text-sm" />
            </label>
            <label className="text-xs">
              <span className="font-medium text-ig-muted">CTA padrão</span>
              <input value={form.default_cta} onChange={(e) => setForm({ ...form, default_cta: e.target.value })} className="ig-input mt-1 w-full text-sm" />
            </label>
            <label className="text-xs">
              <span className="font-medium text-ig-muted">Palavra-chave</span>
              <input value={form.comment_keyword} onChange={(e) => setForm({ ...form, comment_keyword: e.target.value })} className="ig-input mt-1 w-full text-sm" />
            </label>
            <label className="text-xs sm:col-span-2">
              <span className="font-medium text-ig-muted">Link principal</span>
              <input value={form.main_link} onChange={(e) => setForm({ ...form, main_link: e.target.value })} className="ig-input mt-1 w-full text-sm" />
            </label>
            {accountOptions.length > 0 && (
              <div className="sm:col-span-2">
                <p className="text-xs font-medium text-ig-muted">Páginas vinculadas</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {accountOptions.map((account) => {
                    const key = `${account.platform}:${account.id}`;
                    return (
                      <label key={key} className={`flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-xs ${selectedAccounts.includes(key) ? "border-ig-primary bg-ig-primary/10" : "border-ig-border"}`}>
                        <input type="checkbox" checked={selectedAccounts.includes(key)} onChange={() => toggleAccount(key)} />
                        {account.label}
                      </label>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" disabled={saving} onClick={() => void save()} className="ig-btn px-4 py-2 text-sm disabled:opacity-50">
              {saving ? "Salvando…" : "Salvar"}
            </button>
            <button type="button" onClick={() => setShowForm(false)} className="ig-btn-secondary px-4 py-2 text-sm">
              Cancelar
            </button>
          </div>
        </section>
      )}

      <div className="space-y-4">
        {visibleCampaigns.map((campaign) => (
          <article key={campaign.id} className="rounded-2xl border border-ig-border bg-ig-elevated p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold">{campaign.name}</h3>
                <p className="text-sm text-ig-muted">
                  {(campaign.products as { name?: string } | null)?.name ?? "Sem produto"} ·{" "}
                  {CAMPAIGN_OBJECTIVE_LABELS[campaign.objective]}
                </p>
              </div>
              <span className="rounded-full bg-ig-secondary px-2.5 py-1 text-xs font-semibold capitalize">
                {campaign.status}
              </span>
            </div>
            <p className="mt-2 text-xs text-ig-muted">
              {campaign.campaign_accounts?.length ?? 0} página(s) · {campaign.posts_per_day} posts/dia ·{" "}
              {campaign.stories_per_day} stories/dia
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" onClick={() => openEdit(campaign)} className="inline-flex items-center gap-1 rounded-lg border border-ig-border px-3 py-1.5 text-xs">
                <Pencil className="h-3.5 w-3.5" /> Editar
              </button>
              <button type="button" onClick={() => void toggleStatus(campaign)} className="inline-flex items-center gap-1 rounded-lg border border-ig-border px-3 py-1.5 text-xs">
                {campaign.status === "active" ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                {campaign.status === "active" ? "Pausar" : "Retomar"}
              </button>
              <button type="button" onClick={() => void remove(campaign.id)} className="inline-flex items-center gap-1 rounded-lg border border-ig-danger/30 px-3 py-1.5 text-xs text-ig-danger">
                <Trash2 className="h-3.5 w-3.5" /> Excluir
              </button>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
