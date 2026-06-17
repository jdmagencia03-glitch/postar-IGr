"use client";

import { useMemo } from "react";
import { useOptionalUploadSession } from "@/contexts/UploadSessionProvider";
import { deriveUploadSessionView } from "@/lib/upload/session-derived";

export function UploadMainPadding({ children }: { children: React.ReactNode }) {
  const session = useOptionalUploadSession();
  const padded = useMemo(() => {
    if (!session?.batch) return false;
    return deriveUploadSessionView({
      batch: session.batch,
      progress: session.progress,
      progressMap: session.progressMap,
      running: session.running,
      paused: session.paused,
      resuming: session.resuming,
    }).showGlobalBar;
  }, [session]);

  return <div className={padded ? "pb-28" : undefined}>{children}</div>;
}
