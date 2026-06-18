"use client";

import { useCallback, useEffect, useState } from "react";
import { Copy, Pause, Pencil, Play, Plus, Trash2 } from "lucide-react";
import type { Product, ProductStatus } from "@/lib/types";

const emptyForm = {
  name: "",
  niche: "",
  description: "",
  price: "",
  checkout_url: "",
  sales_page_url: "",
  whatsapp_url: "",
  bio_url: "",
  main_cta: "",
  comment_keyword: "",
  dm_message: "",
  coupon: "",
  notes: "",
  status: "active" as ProductStatus,
};

export function ProductsManager({ initialId }: { initialId?: string }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(initialId ?? null);
  const [form, setForm] = useState(emptyForm);
  const [showForm, setShowForm] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/products", { credentials: "include" });
      const data = await res.json();
      setProducts((data.products as Product[]) ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (initialId && products.length) {
      const product = products.find((p) => p.id === initialId);
      if (product) openEdit(product);
    }
  }, [initialId, products]);

  function openCreate() {
    setEditingId(null);
    setForm(emptyForm);
    setShowForm(true);
    setMessage(null);
  }

  function openEdit(product: Product) {
    setEditingId(product.id);
    setForm({
      name: product.name,
      niche: product.niche ?? "",
      description: product.description ?? "",
      price: product.price != null ? String(product.price) : "",
      checkout_url: product.checkout_url ?? "",
      sales_page_url: product.sales_page_url ?? "",
      whatsapp_url: product.whatsapp_url ?? "",
      bio_url: product.bio_url ?? "",
      main_cta: product.main_cta ?? "",
      comment_keyword: product.comment_keyword ?? "",
      dm_message: product.dm_message ?? "",
      coupon: product.coupon ?? "",
      notes: product.notes ?? "",
      status: product.status,
    });
    setShowForm(true);
    setMessage(null);
  }

  async function save() {
    if (!form.name.trim()) {
      setMessage("Nome é obrigatório");
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const url = editingId ? `/api/products/${editingId}` : "/api/products";
      const res = await fetch(url, {
        method: editingId ? "PATCH" : "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(String(data.error ?? "Falha ao salvar"));
      setShowForm(false);
      await load();
      setMessage(editingId ? "Produto atualizado" : "Produto criado");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Erro");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    if (!window.confirm("Excluir este produto?")) return;
    const res = await fetch(`/api/products/${id}`, { method: "DELETE", credentials: "include" });
    if (res.ok) await load();
  }

  async function toggleStatus(product: Product) {
    const res = await fetch(`/api/products/${product.id}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: product.status === "active" ? "paused" : "active" }),
    });
    if (res.ok) await load();
  }

  function copyLink(url: string | null) {
    if (!url) return;
    void navigator.clipboard.writeText(url);
    setMessage("Link copiado");
  }

  if (loading) {
    return <p className="text-sm text-ig-muted">Carregando produtos…</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ig-muted">{products.length} produto(s) cadastrado(s)</p>
        <button type="button" onClick={openCreate} className="ig-btn inline-flex items-center gap-2 px-4 py-2 text-sm">
          <Plus className="h-4 w-4" /> Novo produto
        </button>
      </div>

      {message && <p className="text-sm text-ig-muted">{message}</p>}

      {showForm && (
        <section className="rounded-2xl border border-ig-border bg-ig-elevated p-5">
          <h2 className="text-lg font-semibold">{editingId ? "Editar produto" : "Novo produto"}</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {(
              [
                ["name", "Nome *"],
                ["niche", "Nicho"],
                ["price", "Preço (R$)"],
                ["main_cta", "CTA principal"],
                ["comment_keyword", "Palavra-chave de comentário"],
                ["checkout_url", "Link checkout"],
                ["sales_page_url", "Página de vendas"],
                ["whatsapp_url", "WhatsApp"],
                ["bio_url", "Link da bio"],
                ["coupon", "Cupom"],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="text-xs">
                <span className="font-medium text-ig-muted">{label}</span>
                <input
                  value={form[key]}
                  onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                  className="ig-input mt-1 w-full text-sm"
                />
              </label>
            ))}
            <label className="text-xs sm:col-span-2">
              <span className="font-medium text-ig-muted">Descrição curta</span>
              <textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                rows={2}
                className="ig-input mt-1 w-full text-sm"
              />
            </label>
            <label className="text-xs sm:col-span-2">
              <span className="font-medium text-ig-muted">Mensagem padrão de DM</span>
              <textarea
                value={form.dm_message}
                onChange={(e) => setForm({ ...form, dm_message: e.target.value })}
                rows={2}
                className="ig-input mt-1 w-full text-sm"
              />
            </label>
            <label className="text-xs sm:col-span-2">
              <span className="font-medium text-ig-muted">Observações</span>
              <textarea
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                rows={2}
                className="ig-input mt-1 w-full text-sm"
              />
            </label>
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
        {products.map((product) => (
          <article key={product.id} className="rounded-2xl border border-ig-border bg-ig-elevated p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold text-ig-text">{product.name}</h3>
                <p className="text-sm text-ig-muted">
                  {product.niche ?? "Sem nicho"}
                  {product.price != null ? ` · R$ ${product.price}` : ""}
                </p>
              </div>
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                  product.status === "active"
                    ? "bg-emerald-500/10 text-emerald-700"
                    : "bg-amber-500/10 text-amber-700"
                }`}
              >
                {product.status === "active" ? "Ativo" : "Pausado"}
              </span>
            </div>
            {product.description && <p className="mt-2 text-sm text-ig-muted">{product.description}</p>}
            {product.main_cta && (
              <p className="mt-2 text-sm">
                CTA: <span className="font-medium">{product.main_cta}</span>
              </p>
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" onClick={() => openEdit(product)} className="inline-flex items-center gap-1 rounded-lg border border-ig-border px-3 py-1.5 text-xs">
                <Pencil className="h-3.5 w-3.5" /> Editar
              </button>
              <button type="button" onClick={() => void toggleStatus(product)} className="inline-flex items-center gap-1 rounded-lg border border-ig-border px-3 py-1.5 text-xs">
                {product.status === "active" ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                {product.status === "active" ? "Pausar" : "Ativar"}
              </button>
              {product.checkout_url && (
                <button type="button" onClick={() => copyLink(product.checkout_url)} className="inline-flex items-center gap-1 rounded-lg border border-ig-border px-3 py-1.5 text-xs">
                  <Copy className="h-3.5 w-3.5" /> Copiar link
                </button>
              )}
              <a href={`/dashboard/campaigns?product=${product.id}`} className="rounded-lg border border-ig-border px-3 py-1.5 text-xs">
                Ver campanhas
              </a>
              <button type="button" onClick={() => void remove(product.id)} className="inline-flex items-center gap-1 rounded-lg border border-ig-danger/30 px-3 py-1.5 text-xs text-ig-danger">
                <Trash2 className="h-3.5 w-3.5" /> Excluir
              </button>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
