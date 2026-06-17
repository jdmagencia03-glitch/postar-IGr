"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Plus, RefreshCw, Trash2 } from "lucide-react";
import type { CommentDmAutomationWithAccount, CommentDmEvent } from "@/lib/comment-dm/types";
import { formatDateTime } from "@/lib/utils";

type AccountItem = {
  id: string;
  ig_username: string | null;
  auth_provider?: "instagram" | "facebook" | null;
};

type MediaItem = {
  id: string;
  caption?: string;
  media_type?: string;
  permalink?: string;
  timestamp?: string;
  thumbnail_url?: string;
};

type FormState = {
  account_id: string;
  name: string;
  primary_keyword: string;
  keyword_variations: string;
  dm_message_template: string;
  dm_link: string;
  apply_to: "all" | "specific";
  target_media_ids: string[];
  enabled: boolean;
};

const DEFAULT_TEMPLATE =
  "Oi! Vi que você comentou {keyword}. Aqui está o link para acessar: {link}";

const EMPTY_FORM: FormState = {
  account_id: "",
  name: "Automação DM",
  primary_keyword: "",
  keyword_variations: "",
  dm_message_template: DEFAULT_TEMPLATE,
  dm_link: "",
  apply_to: "all",
  target_media_ids: [],
  enabled: true,
};

const STATUS_LABELS: Record<string, string> = {
  pending: "Pendente",
  sent: "Enviada",
  failed: "Erro",
  skipped: "Ignorada",
};

const STATUS_COLORS: Record<string, string> = {
  pending: "text-amber-600",
  sent: "text-emerald-600",
  failed: "text-ig-danger",
  skipped: "text-ig-muted",
};

function parseVariations(text: string) {
  return text
    .split(/[\n,;]+/)
    .map((v) => v.trim())
    .filter(Boolean);
}

export function CommentDmPanel() {
  const [accounts, setAccounts] = useState<AccountItem[]>([]);
  const [automations, setAutomations] = useState<CommentDmAutomationWithAccount[]>([]);
  const [eventsByAutomation, setEventsByAutomation] = useState<Record<string, CommentDmEvent[]>>({});
  const [mediaItems, setMediaItems] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadingMedia, setLoadingMedia] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  const facebookAccounts = useMemo(
    () => accounts.filter((a) => a.auth_provider === "facebook"),
    [accounts],
  );

  const fetchAccounts = useCallback(async () => {
    const res = await fetch("/api/accounts", { credentials: "include", cache: "no-store" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Falha ao carregar contas");
    setAccounts(data as AccountItem[]);
  }, []);

  const fetchAutomations = useCallback(async () => {
    const res = await fetch("/api/comment-dm/automations", { credentials: "include", cache: "no-store" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Falha ao carregar automações");
    setAutomations(data as CommentDmAutomationWithAccount[]);
  }, []);

  const fetchEvents = useCallback(async (automationId: string) => {
    const res = await fetch(
      `/api/comment-dm/events?automation_id=${automationId}&limit=30`,
      { credentials: "include", cache: "no-store" },
    );
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Falha ao carregar eventos");
    setEventsByAutomation((current) => ({ ...current, [automationId]: data as CommentDmEvent[] }));
  }, []);

  const fetchMedia = useCallback(async (accountId: string) => {
    if (!accountId) {
      setMediaItems([]);
      return;
    }
    setLoadingMedia(true);
    try {
      const res = await fetch(`/api/comment-dm/media?account_id=${accountId}`, {
        credentials: "include",
        cache: "no-store",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Falha ao carregar posts");
      setMediaItems(data as MediaItem[]);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Erro ao carregar posts");
      setMediaItems([]);
    } finally {
      setLoadingMedia(false);
    }
  }, []);

  const refreshAll = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      await Promise.all([fetchAccounts(), fetchAutomations()]);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Erro ao carregar dados");
    } finally {
      setLoading(false);
    }
  }, [fetchAccounts, fetchAutomations]);

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  useEffect(() => {
    if (form.apply_to === "specific" && form.account_id) {
      fetchMedia(form.account_id);
    }
  }, [form.apply_to, form.account_id, fetchMedia]);

  function openCreateForm() {
    const defaultAccount = facebookAccounts[0]?.id ?? "";
    setEditingId(null);
    setForm({
      ...EMPTY_FORM,
      account_id: defaultAccount,
    });
    setShowForm(true);
    setMessage(null);
  }

  function openEditForm(automation: CommentDmAutomationWithAccount) {
    const primary = automation.keywords[0] ?? "";
    const variations = automation.keywords.slice(1).join("\n");
    setEditingId(automation.id);
    setForm({
      account_id: automation.account_id,
      name: automation.name,
      primary_keyword: primary,
      keyword_variations: variations,
      dm_message_template: automation.dm_message_template,
      dm_link: automation.dm_link ?? "",
      apply_to: automation.apply_to,
      target_media_ids: automation.target_media_ids ?? [],
      enabled: automation.enabled,
    });
    setShowForm(true);
    setMessage(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);

    const payload = {
      account_id: form.account_id,
      name: form.name,
      primary_keyword: form.primary_keyword,
      keyword_variations: parseVariations(form.keyword_variations),
      dm_message_template: form.dm_message_template,
      dm_link: form.dm_link || null,
      apply_to: form.apply_to,
      target_media_ids: form.target_media_ids,
      enabled: form.enabled,
    };

    try {
      const url = editingId
        ? `/api/comment-dm/automations/${editingId}`
        : "/api/comment-dm/automations";
      const method = editingId ? "PATCH" : "POST";

      const res = await fetch(url, {
        method,
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Falha ao salvar");

      setShowForm(false);
      setEditingId(null);
      setForm(EMPTY_FORM);
      setMessage(editingId ? "Automação atualizada." : "Automação criada com sucesso.");
      await fetchAutomations();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleEnabled(automation: CommentDmAutomationWithAccount) {
    try {
      const res = await fetch(`/api/comment-dm/automations/${automation.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !automation.enabled }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Falha ao atualizar");
      setAutomations((current) =>
        current.map((a) => (a.id === automation.id ? (data as CommentDmAutomationWithAccount) : a)),
      );
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Erro ao atualizar status");
    }
  }

  async function handleDelete(automationId: string) {
    if (!confirm("Excluir esta automação? O histórico de eventos também será removido.")) return;

    try {
      const res = await fetch(`/api/comment-dm/automations/${automationId}`, {
        method: "DELETE",
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Falha ao excluir");
      setAutomations((current) => current.filter((a) => a.id !== automationId));
      setMessage("Automação excluída.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Erro ao excluir");
    }
  }

  async function handleExpand(automationId: string) {
    if (expandedId === automationId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(automationId);
    if (!eventsByAutomation[automationId]) {
      try {
        await fetchEvents(automationId);
      } catch (err) {
        setMessage(err instanceof Error ? err.message : "Erro ao carregar eventos");
      }
    }
  }

  function toggleMediaSelection(mediaId: string) {
    setForm((current) => {
      const selected = current.target_media_ids.includes(mediaId);
      return {
        ...current,
        target_media_ids: selected
          ? current.target_media_ids.filter((id) => id !== mediaId)
          : [...current.target_media_ids, mediaId],
      };
    });
  }

  if (loading) {
    return (
      <div className="ig-panel flex items-center justify-center gap-2 p-12 text-ig-muted">
        <Loader2 className="animate-spin" size={20} />
        Carregando automações...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {message && (
        <p className="rounded-lg border border-ig-border bg-ig-panel px-4 py-3 text-sm text-ig-text">
          {message}
        </p>
      )}

      {!facebookAccounts.length && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-ig-text">
          Para enviar DMs automáticas, conecte sua conta via{" "}
          <strong>Facebook + Página vinculada ao Instagram Business</strong> em Contas. Contas
          conectadas só pelo Instagram não suportam Private Reply pela API da Meta.
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="ig-btn inline-flex items-center gap-2 px-4 py-2 text-sm"
          onClick={openCreateForm}
          disabled={!facebookAccounts.length}
        >
          <Plus size={16} />
          Nova automação
        </button>
        <button
          type="button"
          className="ig-btn-secondary inline-flex items-center gap-2 px-4 py-2 text-sm"
          onClick={refreshAll}
        >
          <RefreshCw size={16} />
          Atualizar
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="ig-panel space-y-4 p-5">
          <h2 className="text-base font-medium text-ig-text">
            {editingId ? "Editar automação" : "Nova automação de comentário → DM"}
          </h2>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block space-y-1 text-sm">
              <span className="text-ig-muted">Conta Instagram</span>
              <select
                className="ig-input w-full"
                value={form.account_id}
                onChange={(e) => setForm((f) => ({ ...f, account_id: e.target.value }))}
                required
                disabled={Boolean(editingId)}
              >
                <option value="">Selecione...</option>
                {facebookAccounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    @{account.ig_username ?? account.id}
                  </option>
                ))}
              </select>
            </label>

            <label className="block space-y-1 text-sm">
              <span className="text-ig-muted">Nome da automação</span>
              <input
                className="ig-input w-full"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                required
              />
            </label>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block space-y-1 text-sm">
              <span className="text-ig-muted">Palavra-chave principal</span>
              <input
                className="ig-input w-full"
                placeholder="ex: eu quero"
                value={form.primary_keyword}
                onChange={(e) => setForm((f) => ({ ...f, primary_keyword: e.target.value }))}
                required
              />
            </label>

            <label className="block space-y-1 text-sm sm:col-span-2">
              <span className="text-ig-muted">Variações (uma por linha)</span>
              <textarea
                className="ig-input w-full resize-y"
                rows={4}
                placeholder={"quero\nquero sim\nme manda\nmanda o link\ntenho interesse"}
                value={form.keyword_variations}
                onChange={(e) => setForm((f) => ({ ...f, keyword_variations: e.target.value }))}
              />
            </label>
          </div>

          <label className="block space-y-1 text-sm">
            <span className="text-ig-muted">Mensagem da DM</span>
            <textarea
              className="ig-input w-full resize-y"
              rows={4}
              value={form.dm_message_template}
              onChange={(e) => setForm((f) => ({ ...f, dm_message_template: e.target.value }))}
              required
            />
            <span className="text-xs text-ig-muted">
              Variáveis: {"{keyword}"}, {"{username}"}, {"{link}"}
            </span>
          </label>

          <label className="block space-y-1 text-sm">
            <span className="text-ig-muted">Link (opcional)</span>
            <input
              className="ig-input w-full"
              type="url"
              placeholder="https://..."
              value={form.dm_link}
              onChange={(e) => setForm((f) => ({ ...f, dm_link: e.target.value }))}
            />
          </label>

          <fieldset className="space-y-2 text-sm">
            <legend className="text-ig-muted">Aplicar em</legend>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                checked={form.apply_to === "all"}
                onChange={() => setForm((f) => ({ ...f, apply_to: "all", target_media_ids: [] }))}
              />
              Todos os posts e reels
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                checked={form.apply_to === "specific"}
                onChange={() => setForm((f) => ({ ...f, apply_to: "specific" }))}
              />
              Posts/reels específicos
            </label>
          </fieldset>

          {form.apply_to === "specific" && (
            <div className="space-y-2">
              <p className="text-sm text-ig-muted">
                Selecione os posts/reels {loadingMedia && "(carregando...)"}
              </p>
              <div className="max-h-56 space-y-2 overflow-y-auto rounded-lg border border-ig-border p-3">
                {mediaItems.map((media) => (
                  <label
                    key={media.id}
                    className="flex cursor-pointer items-start gap-2 rounded-md p-2 hover:bg-ig-nav-hover"
                  >
                    <input
                      type="checkbox"
                      checked={form.target_media_ids.includes(media.id)}
                      onChange={() => toggleMediaSelection(media.id)}
                      className="mt-1"
                    />
                    <span className="min-w-0 text-sm">
                      <span className="font-medium text-ig-text">
                        {media.media_type ?? "Mídia"} · {media.id.slice(0, 10)}…
                      </span>
                      {media.caption && (
                        <span className="mt-0.5 block truncate text-ig-muted">{media.caption}</span>
                      )}
                    </span>
                  </label>
                ))}
                {!loadingMedia && !mediaItems.length && (
                  <p className="text-sm text-ig-muted">Nenhum post encontrado para esta conta.</p>
                )}
              </div>
            </div>
          )}

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))}
            />
            Ativar automação ao salvar
          </label>

          <div className="flex flex-wrap gap-2">
            <button type="submit" className="ig-btn px-4 py-2 text-sm" disabled={saving}>
              {saving ? "Salvando..." : editingId ? "Salvar alterações" : "Criar automação"}
            </button>
            <button
              type="button"
              className="ig-btn-secondary px-4 py-2 text-sm"
              onClick={() => {
                setShowForm(false);
                setEditingId(null);
              }}
            >
              Cancelar
            </button>
          </div>
        </form>
      )}

      <div className="space-y-3">
        {automations.map((automation) => {
          const events = eventsByAutomation[automation.id] ?? [];
          const isExpanded = expandedId === automation.id;

          return (
            <div key={automation.id} className="ig-panel overflow-hidden">
              <div className="flex flex-wrap items-start justify-between gap-3 p-5">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-medium text-ig-text">{automation.name}</h3>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        automation.enabled
                          ? "bg-emerald-500/15 text-emerald-700"
                          : "bg-ig-nav-hover text-ig-muted"
                      }`}
                    >
                      {automation.enabled ? "Ativa" : "Pausada"}
                    </span>
                  </div>
                  <p className="text-sm text-ig-muted">
                    @{automation.instagram_accounts?.ig_username ?? "conta"} · Palavras:{" "}
                    {automation.keywords.slice(0, 4).join(", ")}
                    {automation.keywords.length > 4 ? "…" : ""}
                  </p>
                  <p className="text-xs text-ig-muted">
                    {automation.apply_to === "all"
                      ? "Todos os posts/reels"
                      : `${automation.target_media_ids.length} post(s) específico(s)`}
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="ig-btn-secondary px-3 py-1.5 text-xs"
                    onClick={() => handleToggleEnabled(automation)}
                  >
                    {automation.enabled ? "Pausar" : "Ativar"}
                  </button>
                  <button
                    type="button"
                    className="ig-btn-secondary px-3 py-1.5 text-xs"
                    onClick={() => openEditForm(automation)}
                  >
                    Editar
                  </button>
                  <button
                    type="button"
                    className="ig-btn-secondary px-3 py-1.5 text-xs text-ig-danger"
                    onClick={() => handleDelete(automation.id)}
                  >
                    <Trash2 size={14} className="inline" />
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-px border-t border-ig-border bg-ig-border text-center text-sm">
                <div className="bg-ig-panel px-3 py-3">
                  <p className="text-lg font-semibold text-ig-text">
                    {automation.total_comments_detected}
                  </p>
                  <p className="text-xs text-ig-muted">Comentários detectados</p>
                </div>
                <div className="bg-ig-panel px-3 py-3">
                  <p className="text-lg font-semibold text-emerald-600">{automation.total_dms_sent}</p>
                  <p className="text-xs text-ig-muted">DMs enviadas</p>
                </div>
                <div className="bg-ig-panel px-3 py-3">
                  <p className="text-lg font-semibold text-ig-danger">{automation.total_failures}</p>
                  <p className="text-xs text-ig-muted">Falhas</p>
                </div>
              </div>

              <div className="border-t border-ig-border px-5 py-3">
                <button
                  type="button"
                  className="text-sm text-ig-link hover:underline"
                  onClick={() => handleExpand(automation.id)}
                >
                  {isExpanded ? "Ocultar histórico" : "Ver histórico de envios e erros"}
                </button>

                {isExpanded && (
                  <div className="mt-3 divide-y divide-ig-border rounded-lg border border-ig-border">
                    {events.map((event) => (
                      <div key={event.id} className="px-3 py-2.5 text-sm">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className={`font-medium ${STATUS_COLORS[event.status] ?? ""}`}>
                            {STATUS_LABELS[event.status] ?? event.status}
                          </span>
                          <span className="text-xs text-ig-muted">
                            {formatDateTime(event.created_at)}
                          </span>
                        </div>
                        {event.commenter_username && (
                          <p className="text-ig-muted">@{event.commenter_username}</p>
                        )}
                        {event.comment_text && (
                          <p className="truncate text-ig-text">
                            Comentário: &quot;{event.comment_text}&quot;
                          </p>
                        )}
                        {event.matched_keyword && (
                          <p className="text-xs text-ig-muted">Palavra: {event.matched_keyword}</p>
                        )}
                        {event.error_message && (
                          <p className="mt-1 text-xs text-ig-danger">{event.error_message}</p>
                        )}
                      </div>
                    ))}
                    {!events.length && (
                      <p className="px-3 py-6 text-center text-sm text-ig-muted">
                        Nenhum evento registrado ainda.
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {!automations.length && (
          <div className="ig-panel px-4 py-12 text-center text-ig-muted">
            Nenhuma automação criada. Clique em &quot;Nova automação&quot; para começar.
          </div>
        )}
      </div>

      <section className="ig-panel space-y-2 p-5 text-sm text-ig-muted">
        <h3 className="font-medium text-ig-text">Como funciona</h3>
        <ul className="list-inside list-disc space-y-1">
          <li>O sistema detecta comentários via webhook da Meta ou busca periódica (cron).</li>
          <li>Quando o texto contém uma palavra-chave, envia Private Reply (DM oficial).</li>
          <li>A Meta permite 1 resposta privada por comentário, em até 7 dias.</li>
          <li>Não enviamos DM duplicada para o mesmo comentário.</li>
          <li>Configure o webhook em Meta Developer apontando para /api/webhooks/meta</li>
        </ul>
      </section>
    </div>
  );
}
