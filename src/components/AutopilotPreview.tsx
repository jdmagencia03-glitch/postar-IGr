"use client";

import { formatDateTime } from "@/lib/utils";
import { Clock, FileVideo, X } from "lucide-react";

export interface PreviewEntry {
  index: number;
  filename: string;
  scheduled_at: string;
  caption: string;
}

interface Props {
  entries: PreviewEntry[];
  accounts: Array<{ ig_username: string | null }>;
  scheduleSummary: string;
  durationLabel?: string;
  captionSource: "ai" | "fallback";
  totalPosts: number;
  loading?: boolean;
  onCaptionChange: (index: number, caption: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

export function AutopilotPreview({
  entries,
  accounts,
  scheduleSummary,
  durationLabel,
  captionSource,
  totalPosts,
  loading,
  onCaptionChange,
  onConfirm,
  onCancel,
}: Props) {
  const accountLabels = accounts.map((a) => `@${a.ig_username ?? "conta"}`).join(", ");

  return (
    <div className="ig-overlay fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center">
      <div className="ig-card flex max-h-[90vh] w-full max-w-3xl flex-col shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-ig-border px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold text-ig-text">Prévia do agendamento IA</h2>
            <p className="mt-1 text-sm text-ig-muted">
              {entries.length} vídeo(s) · {accountLabels} · {totalPosts} post(s) no total
            </p>
            <p className="mt-1 text-xs text-ig-muted">
              {captionSource === "ai" ? "Legendas geradas com GPT" : "Legendas automáticas"} ·{" "}
              {durationLabel || scheduleSummary}
            </p>
            <p className="mt-1 text-xs text-ig-muted">
              O vídeo não é editado — apenas legenda, hashtags e horário são definidos pela IA.
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="rounded-lg border border-ig-border p-2 text-ig-muted hover:bg-ig-secondary hover:text-ig-text disabled:opacity-50"
          >
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4 overflow-y-auto px-5 py-4">
          {entries.map((entry) => (
            <article
              key={entry.index}
              className="rounded-xl border border-ig-border bg-ig-secondary p-4"
            >
              <div className="mb-3 flex flex-wrap items-center gap-3 text-sm">
                <span className="flex items-center gap-1.5 font-medium text-ig-text">
                  <FileVideo size={14} className="text-ig-primary" />
                  {entry.filename}
                </span>
                <span className="flex items-center gap-1.5 text-ig-text">
                  <Clock size={14} />
                  {formatDateTime(entry.scheduled_at)}
                </span>
              </div>
              <label className="mb-2 block text-xs text-ig-muted">
                Legenda (edite se quiser)
              </label>
              <textarea
                value={entry.caption}
                onChange={(e) => onCaptionChange(entry.index, e.target.value)}
                rows={5}
                disabled={loading}
                className="w-full rounded-lg border border-ig-border bg-ig-secondary px-3 py-2 text-sm text-ig-text disabled:opacity-60"
              />
            </article>
          ))}
        </div>

        <div className="flex flex-col gap-2 border-t border-ig-border px-5 py-4 sm:flex-row">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="flex-1 rounded-lg border border-ig-border bg-ig-secondary px-4 py-3 text-sm text-ig-text hover:bg-ig-secondary disabled:opacity-50"
          >
            Voltar e ajustar
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className="flex-1 ig-btn px-4 py-3 text-sm disabled:opacity-50"
          >
            {loading ? "Agendando..." : `Confirmar ${totalPosts} post(s)`}
          </button>
        </div>
      </div>
    </div>
  );
}
