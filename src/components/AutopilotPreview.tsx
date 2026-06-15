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
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4 sm:items-center">
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-2xl border border-white/10 bg-zinc-950 shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-white/10 px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold text-white">Prévia do agendamento IA</h2>
            <p className="mt-1 text-sm text-zinc-400">
              {entries.length} vídeo(s) · {accountLabels} · {totalPosts} post(s) no total
            </p>
            <p className="mt-1 text-xs text-zinc-500">
              {captionSource === "ai" ? "Legendas geradas com GPT" : "Legendas automáticas"} ·{" "}
              {durationLabel || scheduleSummary}
            </p>
            <p className="mt-1 text-xs text-zinc-600">
              O vídeo não é editado — apenas legenda, hashtags e horário são definidos pela IA.
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="rounded-lg border border-white/10 p-2 text-zinc-400 hover:bg-white/5 hover:text-white disabled:opacity-50"
          >
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4 overflow-y-auto px-5 py-4">
          {entries.map((entry) => (
            <article
              key={entry.index}
              className="rounded-xl border border-white/10 bg-white/5 p-4"
            >
              <div className="mb-3 flex flex-wrap items-center gap-3 text-sm">
                <span className="flex items-center gap-1.5 font-medium text-white">
                  <FileVideo size={14} className="text-pink-400" />
                  {entry.filename}
                </span>
                <span className="flex items-center gap-1.5 text-emerald-300">
                  <Clock size={14} />
                  {formatDateTime(entry.scheduled_at)}
                </span>
              </div>
              <label className="mb-2 block text-xs text-zinc-500">
                Legenda (edite se quiser)
              </label>
              <textarea
                value={entry.caption}
                onChange={(e) => onCaptionChange(entry.index, e.target.value)}
                rows={5}
                disabled={loading}
                className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white disabled:opacity-60"
              />
            </article>
          ))}
        </div>

        <div className="flex flex-col gap-2 border-t border-white/10 px-5 py-4 sm:flex-row">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="flex-1 rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-sm text-zinc-200 hover:bg-white/10 disabled:opacity-50"
          >
            Voltar e ajustar
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className="flex-1 rounded-lg bg-gradient-to-r from-pink-500 to-purple-600 px-4 py-3 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {loading ? "Agendando..." : `Confirmar ${totalPosts} post(s)`}
          </button>
        </div>
      </div>
    </div>
  );
}
