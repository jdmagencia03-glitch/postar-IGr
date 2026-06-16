"use client";

import { memo } from "react";
import { useOptionalUploadContext, useUploadProgress } from "@/contexts/UploadContext";

export const UploadGlobalBar = memo(function UploadGlobalBar() {
  const context = useOptionalUploadContext();
  const progress = useUploadProgress();

  if (!context?.isActive || !progress) return null;

  const { batchNumber } = context;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-ig-border bg-ig-elevated/95 px-4 py-3 backdrop-blur">
      <div className="mx-auto max-w-6xl">
        <div className="min-w-0">
          <p className="text-sm font-medium text-ig-text">
            Upload em andamento{batchNumber ? ` · Lote #${batchNumber}` : ""}
          </p>
          <p className="text-xs text-ig-muted">
            {progress.completed}/{progress.total} vídeos · {progress.overallPercent}%
          </p>
          <div className="mt-2 h-1.5 max-w-md overflow-hidden rounded-full bg-ig-secondary">
            <div
              className="h-full rounded-full bg-ig-primary transition-none"
              style={{ width: `${progress.overallPercent}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
});
