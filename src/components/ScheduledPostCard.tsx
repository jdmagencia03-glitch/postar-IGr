"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { PostCard } from "@/components/PostCard";
import { formatDateTime } from "@/lib/utils";
import { fromDateTimeLocalInAppTz, toDateTimeLocalInAppTz } from "@/lib/timezone";
import type { PostStatus, ScheduledPost } from "@/lib/types";

type DialogKind =
  | "delete"
  | "cancel-processing"
  | "hide"
  | "instagram-delete"
  | "edit"
  | "reschedule"
  | null;

interface Props {
  post: ScheduledPost;
  selectable?: boolean;
  selected?: boolean;
  onSelect?: (selected: boolean) => void;
  onUpdated?: () => void;
  publishedMeta?: string | null;
  rich?: boolean;
}

async function apiFetch(input: RequestInfo | URL, init?: RequestInit) {
  const response = await fetch(input, { ...init, credentials: "include" });
  if (response.status === 401) {
    window.location.href = "/login?next=/dashboard/reports";
    throw new Error("Sessão expirada. Faça login novamente.");
  }
  return response;
}

function toDateTimeLocalValue(iso: string) {
  return toDateTimeLocalInAppTz(iso);
}

function fromDateTimeLocalValue(value: string) {
  return fromDateTimeLocalInAppTz(value);
}

function actionButtonClass() {
  return "rounded-lg border border-ig-border bg-ig-secondary px-3 py-1.5 text-xs font-medium text-ig-text hover:bg-ig-elevated disabled:opacity-50";
}

export function ScheduledPostCard({
  post,
  selectable = false,
  selected = false,
  onSelect,
  onUpdated,
  publishedMeta,
  rich = false,
}: Props) {
  const router = useRouter();
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [captionDraft, setCaptionDraft] = useState(post.caption ?? "");
  const [scheduleDraft, setScheduleDraft] = useState(toDateTimeLocalValue(post.scheduled_at));

  const status = post.status as PostStatus;

  const isConfirmDialog =
    dialog === "delete" ||
    dialog === "cancel-processing" ||
    dialog === "hide" ||
    dialog === "instagram-delete";

  const dialogCopy = useMemo(() => {
    if (dialog === "delete") {
      return {
        title: "Excluir este vídeo agendado?",
        description: "Ele será removido da fila e não será publicado.",
        confirmLabel: "Excluir definitivamente",
      };
    }
    if (dialog === "cancel-processing") {
      return {
        title: "Cancelar envio em andamento?",
        description:
          "O post será removido da fila. Se o Instagram já estiver publicando, a publicação pode continuar.",
        confirmLabel: "Cancelar envio",
      };
    }
    if (dialog === "hide") {
      return {
        title: "Ocultar do relatório?",
        description: "O post continuará publicado no Instagram, mas não aparecerá mais neste relatório.",
        confirmLabel: "Ocultar",
        confirmTone: "primary" as const,
      };
    }
    if (dialog === "instagram-delete") {
      return {
        title: "Excluir publicação do Instagram?",
        description:
          "Esta ação é irreversível. A publicação será removida do Instagram e ocultada do relatório.",
        confirmLabel: "Excluir do Instagram",
      };
    }
    return null;
  }, [dialog]);

  async function refreshView() {
    onUpdated?.();
    router.refresh();
  }

  async function handleDelete() {
    setLoading(true);
    setMessage(null);
    try {
      const response = await apiFetch(`/api/posts/${post.id}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(String(data.error ?? "Falha ao excluir"));
      setDialog(null);
      await refreshView();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Erro ao excluir");
    } finally {
      setLoading(false);
    }
  }

  async function handleRetry() {
    setLoading(true);
    setMessage(null);
    try {
      const response = await apiFetch(`/api/posts/${post.id}/retry`, { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(String(data.error ?? "Falha ao reenviar"));
      await refreshView();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Erro ao reenviar");
    } finally {
      setLoading(false);
    }
  }

  async function handleHide() {
    setLoading(true);
    setMessage(null);
    try {
      const response = await apiFetch(`/api/posts/${post.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hidden_from_report: true }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(String(data.error ?? "Falha ao ocultar"));
      setDialog(null);
      await refreshView();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Erro ao ocultar");
    } finally {
      setLoading(false);
    }
  }

  async function handleInstagramDelete() {
    setLoading(true);
    setMessage(null);
    try {
      const response = await apiFetch(`/api/posts/${post.id}/instagram`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(String(data.error ?? "Falha ao excluir no Instagram"));
      setDialog(null);
      await refreshView();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Erro ao excluir no Instagram");
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveEdit() {
    setLoading(true);
    setMessage(null);
    try {
      const response = await apiFetch(`/api/posts/${post.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caption: captionDraft }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(String(data.error ?? "Falha ao salvar legenda"));
      setDialog(null);
      await refreshView();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Erro ao salvar legenda");
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveReschedule() {
    setLoading(true);
    setMessage(null);
    try {
      const response = await apiFetch(`/api/posts/${post.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scheduled_at: fromDateTimeLocalValue(scheduleDraft) }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(String(data.error ?? "Falha ao reagendar"));
      setDialog(null);
      await refreshView();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Erro ao reagendar");
    } finally {
      setLoading(false);
    }
  }

  async function handleDuplicate() {
    setLoading(true);
    setMessage(null);
    try {
      const response = await apiFetch(`/api/posts/${post.id}/duplicate`, { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(String(data.error ?? "Falha ao duplicar"));
      await refreshView();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Erro ao duplicar");
    } finally {
      setLoading(false);
    }
  }

  async function handleConfirmDialog() {
    if (dialog === "delete" || dialog === "cancel-processing") return handleDelete();
    if (dialog === "hide") return handleHide();
    if (dialog === "instagram-delete") return handleInstagramDelete();
  }

  function renderActions() {
    if (status === "pending") {
      return (
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className={actionButtonClass()} onClick={() => { setCaptionDraft(post.caption ?? ""); setDialog("edit"); }}>
            ✏ Editar
          </button>
          <button type="button" className={actionButtonClass()} onClick={() => { setScheduleDraft(toDateTimeLocalValue(post.scheduled_at)); setDialog("reschedule"); }}>
            📅 Reagendar
          </button>
          <button type="button" className={actionButtonClass()} onClick={() => setDialog("delete")}>
            🗑 Excluir
          </button>
          <button type="button" className={actionButtonClass()} disabled={loading} onClick={handleDuplicate}>
            📋 Duplicar
          </button>
        </div>
      );
    }

    if (status === "processing") {
      return (
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className={actionButtonClass()} disabled={loading} onClick={handleRetry}>
            {loading ? "Reenviando..." : "Tentar novamente"}
          </button>
          <button type="button" className={actionButtonClass()} onClick={() => setDialog("cancel-processing")}>
            Cancelar envio
          </button>
        </div>
      );
    }

    if (status === "published") {
      const isTikTok = post.platform === "tiktok";

      return (
        <div className="mt-3 flex flex-wrap gap-2">
          {post.permalink && (
            <a
              href={post.permalink}
              target="_blank"
              rel="noreferrer"
              className={actionButtonClass()}
            >
              {isTikTok ? "🎵 Ver no TikTok" : "📲 Ver no Instagram"}
            </a>
          )}
          <button type="button" className={actionButtonClass()} onClick={() => setDialog("hide")}>
            Ocultar do relatório
          </button>
          <button type="button" className={actionButtonClass()} disabled={loading} onClick={handleDuplicate}>
            📋 Duplicar
          </button>
          {!isTikTok && (
            <button
              type="button"
              className="rounded-lg border border-ig-danger/30 bg-ig-danger/10 px-3 py-1.5 text-xs font-medium text-ig-danger hover:bg-ig-danger/15 disabled:opacity-50"
              onClick={() => setDialog("instagram-delete")}
            >
              Excluir publicação do Instagram
            </button>
          )}
        </div>
      );
    }

    if (status === "failed") {
      return (
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className={actionButtonClass()} disabled={loading} onClick={handleRetry}>
            {loading ? "Reenviando..." : "Tentar novamente"}
          </button>
          <button type="button" className={actionButtonClass()} onClick={() => setDialog("delete")}>
            🗑 Excluir
          </button>
          <button type="button" className={actionButtonClass()} disabled={loading} onClick={handleDuplicate}>
            📋 Duplicar
          </button>
        </div>
      );
    }

    return null;
  }

  return (
    <>
      <div className="relative">
        {selectable && (
          <label className="absolute right-3 top-3 z-10 flex items-center gap-2 rounded-lg bg-ig-elevated/90 px-2 py-1 text-xs text-ig-muted">
            <input
              type="checkbox"
              checked={selected}
              onChange={(event) => onSelect?.(event.target.checked)}
              className="rounded border-ig-border"
            />
            Selecionar
          </label>
        )}
        <PostCard post={post} hidePermalink={status === "published"} rich={rich} />
        {publishedMeta && (
          <p className="mt-2 text-xs text-ig-text">{publishedMeta}</p>
        )}
        {renderActions()}
        {message && <p className="mt-2 text-xs text-ig-danger">{message}</p>}
      </div>

      {dialogCopy && isConfirmDialog && (
        <ConfirmDialog
          open
          title={dialogCopy.title}
          description={dialogCopy.description}
          confirmLabel={dialogCopy.confirmLabel}
          confirmTone={dialogCopy.confirmTone ?? "danger"}
          loading={loading}
          onCancel={() => setDialog(null)}
          onConfirm={handleConfirmDialog}
        />
      )}

      {dialog === "edit" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button type="button" aria-label="Fechar" className="absolute inset-0 bg-black/50" onClick={() => setDialog(null)} />
          <div className="relative w-full max-w-lg rounded-2xl border border-ig-border bg-ig-elevated p-5 shadow-xl">
            <h3 className="text-lg font-semibold text-ig-text">Editar legenda</h3>
            <textarea
              value={captionDraft}
              onChange={(event) => setCaptionDraft(event.target.value)}
              rows={6}
              className="ig-input mt-3 w-full resize-y"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className="rounded-lg border border-ig-border px-4 py-2 text-sm" onClick={() => setDialog(null)}>
                Cancelar
              </button>
              <button type="button" className="ig-btn px-4 py-2 text-sm" disabled={loading} onClick={handleSaveEdit}>
                {loading ? "Salvando..." : "Salvar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {dialog === "reschedule" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button type="button" aria-label="Fechar" className="absolute inset-0 bg-black/50" onClick={() => setDialog(null)} />
          <div className="relative w-full max-w-lg rounded-2xl border border-ig-border bg-ig-elevated p-5 shadow-xl">
            <h3 className="text-lg font-semibold text-ig-text">Reagendar publicação</h3>
            <p className="mt-1 text-sm text-ig-muted">
              Agendado para {formatDateTime(post.scheduled_at)} (horário de Brasília)
            </p>
            <input
              type="datetime-local"
              value={scheduleDraft}
              onChange={(event) => setScheduleDraft(event.target.value)}
              className="ig-input mt-3 w-full"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className="rounded-lg border border-ig-border px-4 py-2 text-sm" onClick={() => setDialog(null)}>
                Cancelar
              </button>
              <button type="button" className="ig-btn px-4 py-2 text-sm" disabled={loading} onClick={handleSaveReschedule}>
                {loading ? "Salvando..." : "Reagendar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
