"use client";

import { useOptionalUploadContext } from "@/contexts/UploadContext";

export function UploadGlobalBar() {
  const context = useOptionalUploadContext();

  if (!context?.isActive || !context.progress) return null;

  const { progress, batchNumber } = context;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-ig-border bg-ig-elevated/95 px-4 py-3 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-ig-text">
            Upload em andamento{batchNumber ? ` · Lote #${batchNumber}` : ""}
          </p>
          <p className="text-xs text-ig-muted">
            {progress.completed}/{progress.total} vídeos · {progress.overallPercent}%
          </p>
          <div className="mt-2 h-1.5 max-w-md overflow-hidden rounded-full bg-ig-secondary">
            <div
              className="h-full rounded-full bg-ig-primary"
              style={{ width: `${progress.overallPercent}%` }}
            />
          </div>
        </div>
        <a href="/dashboard/bulk" className="ig-btn-secondary shrink-0 px-4 py-2 text-sm font-semibold">
          Ver detalhes
        </a>
      </div>
    </div>
  );
}
