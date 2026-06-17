"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ScheduledPostCard } from "@/components/ScheduledPostCard";
import { fromDateTimeLocalInAppTz } from "@/lib/timezone";
import { formatDateTime } from "@/lib/utils";
import type { ScheduledPost } from "@/lib/types";

interface Props {
  posts: ScheduledPost[];
  /** Posts usados em “Selecionar todos” e ações em lote. Se omitido, usa `posts`. */
  bulkScopePosts?: ScheduledPost[];
  enableBulk?: boolean;
  showPublishedMeta?: boolean;
  rich?: boolean;
}

type BulkDialog = "reschedule" | "caption" | "delete" | "duplicate" | null;

async function apiFetch(input: RequestInfo | URL, init?: RequestInit) {
  const response = await fetch(input, { ...init, credentials: "include" });
  if (response.status === 401) {
    window.location.href = "/login?next=/dashboard/reports";
    throw new Error("Sessão expirada. Faça login novamente.");
  }
  return response;
}

function fromDateTimeLocalValue(value: string) {
  return fromDateTimeLocalInAppTz(value);
}

export function PostsManager({
  posts,
  bulkScopePosts,
  enableBulk = false,
  showPublishedMeta = false,
  rich = false,
}: Props) {
  const router = useRouter();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkDialog, setBulkDialog] = useState<BulkDialog>(null);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkMessage, setBulkMessage] = useState<string | null>(null);
  const [scheduleDraft, setScheduleDraft] = useState("");
  const [captionDraft, setCaptionDraft] = useState("");

  const bulkPosts = bulkScopePosts ?? posts;

  const selectableIds = useMemo(() => bulkPosts.map((post) => post.id), [bulkPosts]);

  useEffect(() => {
    setSelectedIds((current) => {
      const next = current.filter((id) => selectableIds.includes(id));
      return next.length === current.length ? current : next;
    });
  }, [selectableIds]);

  const selectionMode = enableBulk && selectedIds.length > 0;

  const allSelected =
    selectableIds.length > 0 && selectableIds.every((id) => selectedIds.includes(id));

  function toggleSelectAll() {
    setSelectedIds((current) => {
      const everySelected =
        selectableIds.length > 0 && selectableIds.every((id) => current.includes(id));
      return everySelected ? [] : [...selectableIds];
    });
  }

  function toggleSelect(postId: string, selected: boolean) {
    setSelectedIds((current) =>
      selected ? [...new Set([...current, postId])] : current.filter((id) => id !== postId),
    );
  }

  const editablePostIds = useMemo(
    () =>
      bulkPosts
        .filter((post) => post.status === "pending" || post.status === "failed")
        .map((post) => post.id),
    [bulkPosts],
  );

  async function formatCaptions() {
    const targetIds = selectedIds.length
      ? selectedIds.filter((id) => editablePostIds.includes(id))
      : editablePostIds;

    if (!targetIds.length) {
      setBulkMessage("Nenhum post pendente ou com falha para formatar legendas.");
      return;
    }

    setBulkLoading(true);
    setBulkMessage(null);

    try {
      const response = await apiFetch("/api/posts/format-captions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ post_ids: targetIds }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(String(data.error ?? "Falha ao formatar legendas"));
      }

      setSelectedIds([]);
      setBulkMessage(String(data.message ?? `${data.updated ?? 0} legenda(s) reformatada(s)`));
      router.refresh();
    } catch (error) {
      setBulkMessage(error instanceof Error ? error.message : "Erro ao formatar legendas");
    } finally {
      setBulkLoading(false);
    }
  }

  async function runBulkAction(action: "delete" | "reschedule" | "update_caption" | "duplicate") {
    if (!selectedIds.length) return;

    setBulkLoading(true);
    setBulkMessage(null);

    try {
      const response = await apiFetch("/api/posts/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          post_ids: selectedIds,
          ...(action === "reschedule" && scheduleDraft
            ? { scheduled_at: fromDateTimeLocalValue(scheduleDraft) }
            : {}),
          ...(action === "update_caption" ? { caption: captionDraft } : {}),
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(String(data.error ?? "Falha na ação em massa"));
      }

      setBulkDialog(null);
      setSelectedIds([]);
      setBulkMessage(
        `${data.succeeded ?? 0} post(s) atualizados${
          data.failed ? ` · ${data.failed} não puderam ser alterados` : ""
        }`,
      );
      router.refresh();
    } catch (error) {
      setBulkMessage(error instanceof Error ? error.message : "Erro na ação em massa");
    } finally {
      setBulkLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      {enableBulk && posts.length > 0 && (
        <div className="rounded-xl border border-ig-border bg-ig-secondary p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-sm font-medium text-ig-text">Selecionar posts</p>
              <button
                type="button"
                onClick={toggleSelectAll}
                className="rounded-lg border border-ig-border bg-ig-elevated px-3 py-1.5 text-xs font-medium text-ig-text hover:bg-ig-secondary"
              >
                {allSelected ? "Desmarcar todos" : `Selecionar todos (${selectableIds.length})`}
              </button>
            </div>
            <p className="text-xs text-ig-muted">
              {selectedIds.length
                ? `${selectedIds.length} de ${selectableIds.length} selecionado(s)`
                : bulkScopePosts && bulkScopePosts.length > posts.length
                  ? `${posts.length} visíveis · ${selectableIds.length} no total — marque ou use Selecionar todos`
                  : "Marque os cards abaixo para agir em lote"}
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={!editablePostIds.length || bulkLoading}
                onClick={() => void formatCaptions()}
                className="rounded-lg border border-ig-primary/40 bg-ig-primary/10 px-3 py-2 text-sm text-ig-primary disabled:opacity-50"
              >
                ✨ {selectedIds.length ? "Formatar selecionados" : "Formatar todas as legendas"}
              </button>
              <button
                type="button"
                disabled={!selectionMode || bulkLoading}
                onClick={() => setBulkDialog("delete")}
                className="rounded-lg border border-ig-border px-3 py-2 text-sm disabled:opacity-50"
              >
                🗑 Excluir selecionados
              </button>
              <button
                type="button"
                disabled={!selectionMode || bulkLoading}
                onClick={() => setBulkDialog("reschedule")}
                className="rounded-lg border border-ig-border px-3 py-2 text-sm disabled:opacity-50"
              >
                📅 Reagendar selecionados
              </button>
              <button
                type="button"
                disabled={!selectionMode || bulkLoading}
                onClick={() => setBulkDialog("caption")}
                className="rounded-lg border border-ig-border px-3 py-2 text-sm disabled:opacity-50"
              >
                ✏ Editar selecionados
              </button>
              <button
                type="button"
                disabled={!selectionMode || bulkLoading}
                onClick={() => setBulkDialog("duplicate")}
                className="rounded-lg border border-ig-border px-3 py-2 text-sm disabled:opacity-50"
              >
                📋 Duplicar selecionados
              </button>
              {selectedIds.length > 0 && (
                <button
                  type="button"
                  onClick={() => setSelectedIds([])}
                  className="rounded-lg px-3 py-2 text-sm text-ig-muted hover:underline"
                >
                  Limpar seleção
                </button>
              )}
            </div>
          </div>
          {bulkMessage && <p className="mt-2 text-sm text-ig-muted">{bulkMessage}</p>}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {posts.map((post) => (
          <ScheduledPostCard
            key={post.id}
            post={post}
            selectable={enableBulk}
            selected={selectedIds.includes(post.id)}
            onSelect={(selected) => toggleSelect(post.id, selected)}
            onUpdated={() => router.refresh()}
            rich={rich}
            publishedMeta={
              showPublishedMeta && post.status === "published" && post.published_at
                ? `Publicado em ${formatDateTime(post.published_at)}`
                : null
            }
          />
        ))}
      </div>

      {bulkDialog === "delete" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            aria-label="Fechar"
            className="absolute inset-0 bg-black/50"
            onClick={() => setBulkDialog(null)}
          />
          <div className="relative w-full max-w-md rounded-2xl border border-ig-border bg-ig-elevated p-5 shadow-xl">
            <h3 className="text-lg font-semibold text-ig-text">Excluir posts selecionados?</h3>
            <p className="mt-2 text-sm text-ig-muted">
              {selectedIds.length} post(s) serão removidos da fila. Posts publicados serão ignorados.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" className="rounded-lg border border-ig-border px-4 py-2 text-sm" onClick={() => setBulkDialog(null)}>
                Cancelar
              </button>
              <button
                type="button"
                className="rounded-lg bg-ig-danger px-4 py-2 text-sm font-medium text-white"
                disabled={bulkLoading}
                onClick={() => runBulkAction("delete")}
              >
                {bulkLoading ? "Excluindo..." : "Excluir definitivamente"}
              </button>
            </div>
          </div>
        </div>
      )}

      {bulkDialog === "reschedule" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button type="button" aria-label="Fechar" className="absolute inset-0 bg-black/50" onClick={() => setBulkDialog(null)} />
          <div className="relative w-full max-w-md rounded-2xl border border-ig-border bg-ig-elevated p-5 shadow-xl">
            <h3 className="text-lg font-semibold text-ig-text">Reagendar selecionados</h3>
            <p className="mt-1 text-sm text-ig-muted">
              O primeiro post usará este horário. Os demais serão espaçados de 1 em 1 minuto.
            </p>
            <input
              type="datetime-local"
              value={scheduleDraft}
              onChange={(event) => setScheduleDraft(event.target.value)}
              className="ig-input mt-3 w-full"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className="rounded-lg border border-ig-border px-4 py-2 text-sm" onClick={() => setBulkDialog(null)}>
                Cancelar
              </button>
              <button
                type="button"
                className="ig-btn px-4 py-2 text-sm"
                disabled={bulkLoading || !scheduleDraft}
                onClick={() => runBulkAction("reschedule")}
              >
                {bulkLoading ? "Salvando..." : "Reagendar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {bulkDialog === "caption" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button type="button" aria-label="Fechar" className="absolute inset-0 bg-black/50" onClick={() => setBulkDialog(null)} />
          <div className="relative w-full max-w-lg rounded-2xl border border-ig-border bg-ig-elevated p-5 shadow-xl">
            <h3 className="text-lg font-semibold text-ig-text">Alterar legenda dos selecionados</h3>
            <p className="mt-1 text-sm text-ig-muted">
              A mesma legenda será aplicada aos posts pendentes ou com falha selecionados.
            </p>
            <textarea
              value={captionDraft}
              onChange={(event) => setCaptionDraft(event.target.value)}
              rows={6}
              className="ig-input mt-3 w-full resize-y"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className="rounded-lg border border-ig-border px-4 py-2 text-sm" onClick={() => setBulkDialog(null)}>
                Cancelar
              </button>
              <button
                type="button"
                className="ig-btn px-4 py-2 text-sm"
                disabled={bulkLoading}
                onClick={() => runBulkAction("update_caption")}
              >
                {bulkLoading ? "Salvando..." : "Aplicar legenda"}
              </button>
            </div>
          </div>
        </div>
      )}
      {bulkDialog === "duplicate" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button type="button" aria-label="Fechar" className="absolute inset-0 bg-black/50" onClick={() => setBulkDialog(null)} />
          <div className="relative w-full max-w-md rounded-2xl border border-ig-border bg-ig-elevated p-5 shadow-xl">
            <h3 className="text-lg font-semibold text-ig-text">Duplicar posts selecionados?</h3>
            <p className="mt-2 text-sm text-ig-muted">
              Serão criadas cópias pendentes, uma por dia a partir da data original.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" className="rounded-lg border border-ig-border px-4 py-2 text-sm" onClick={() => setBulkDialog(null)}>
                Cancelar
              </button>
              <button
                type="button"
                className="ig-btn px-4 py-2 text-sm"
                disabled={bulkLoading}
                onClick={() => runBulkAction("duplicate")}
              >
                {bulkLoading ? "Duplicando..." : "Duplicar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
