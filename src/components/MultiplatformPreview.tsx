"use client";

import { formatDateTime } from "@/lib/utils";
import type { MultiplatformVideoPreview } from "@/lib/multiplatform/types";
import { CONTENT_TYPE_LABELS } from "@/lib/content-types";
import { Clock, FileVideo, X } from "lucide-react";

interface Props {
  videos: MultiplatformVideoPreview[];
  scheduleSummary: string;
  captionSource: "ai" | "fallback";
  totalPosts: number;
  loading?: boolean;
  onCaptionChange: (videoIndex: number, platform: "instagram" | "tiktok", caption: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

function platformLabel(platform: "instagram" | "tiktok") {
  return platform === "tiktok" ? "TikTok" : "Instagram Reels";
}

export function MultiplatformPreview({
  videos,
  scheduleSummary,
  captionSource,
  totalPosts,
  loading,
  onCaptionChange,
  onConfirm,
  onCancel,
}: Props) {
  return (
    <div className="ig-overlay fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center">
      <div className="ig-card flex max-h-[90vh] w-full max-w-3xl flex-col shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-ig-border px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold text-ig-text">Prévia do agendamento</h2>
            <p className="mt-1 text-sm text-ig-muted">
              {videos.length} vídeo(s) · {totalPosts} publicação(ões) no total
            </p>
            <p className="mt-1 text-xs text-ig-muted">
              {captionSource === "ai" ? "Legendas geradas com IA por plataforma" : "Legendas automáticas"} ·{" "}
              {scheduleSummary}
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
          {videos.map((video) => (
            <article
              key={video.parent_publish_group_id}
              className="rounded-xl border border-ig-border bg-ig-secondary p-4"
            >
              <div className="mb-3 flex flex-wrap items-center gap-3 text-sm">
                <span className="flex items-center gap-1.5 font-medium text-ig-text">
                  <FileVideo size={14} className="text-ig-primary" />
                  {video.filename}
                </span>
              </div>

              <div className="space-y-4">
                {video.destinations.map((dest) => (
                  <div
                    key={`${video.parent_publish_group_id}-${dest.platform}`}
                    className="rounded-lg border border-ig-border bg-ig-elevated p-3"
                  >
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-ig-text">
                        {platformLabel(dest.platform)}
                      </p>
                      <span className="rounded-full bg-ig-secondary px-2 py-0.5 text-[10px] font-medium uppercase text-ig-muted">
                        {CONTENT_TYPE_LABELS[dest.content_type]}
                      </span>
                    </div>
                    <p className="mb-2 text-xs text-ig-muted">
                      Conta: @{dest.username}
                    </p>
                    <p className="mb-3 flex items-center gap-1.5 text-xs text-ig-text">
                      <Clock size={12} />
                      {formatDateTime(dest.scheduled_at)}
                    </p>
                    <label className="mb-1 block text-xs text-ig-muted">Legenda</label>
                    <textarea
                      value={dest.caption}
                      onChange={(e) =>
                        onCaptionChange(video.index, dest.platform, e.target.value)
                      }
                      rows={dest.platform === "tiktok" ? 3 : 5}
                      disabled={loading}
                      className="w-full rounded-lg border border-ig-border bg-ig-secondary px-3 py-2 text-sm text-ig-text disabled:opacity-60"
                    />
                  </div>
                ))}
              </div>
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
            {loading ? "Agendando..." : `Confirmar ${totalPosts} publicação(ões)`}
          </button>
        </div>
      </div>
    </div>
  );
}
