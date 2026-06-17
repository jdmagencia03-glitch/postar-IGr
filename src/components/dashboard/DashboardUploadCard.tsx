"use client";

import Link from "next/link";
import { ExternalLink, Loader2, Upload } from "lucide-react";
import { useMemo } from "react";
import { useOptionalUploadSession } from "@/contexts/UploadSessionProvider";
import { deriveUploadSessionView } from "@/lib/upload/session-derived";
import { formatBytes } from "@/lib/upload/validate";

export function DashboardUploadCard() {
  const session = useOptionalUploadSession();

  const view = useMemo(() => {
    if (!session) return null;
    return deriveUploadSessionView({
      batch: session.batch,
      progress: session.progress,
      progressMap: session.progressMap,
      running: session.running,
      paused: session.paused,
      resuming: session.resuming,
    });
  }, [session]);

  const activeFile = useMemo(() => {
    if (!session?.batch) return null;
    const files = session.batch.upload_files?.filter((f) => !f.removed) ?? [];
    return (
      files.find((f) => f.status === "uploading") ??
      files.find((f) => f.status === "pending" && (session.progressMap[f.id] ?? 0) > 0) ??
      files.find((f) => f.status !== "completed")
    );
  }, [session]);

  const showCard = Boolean(session?.batch && view?.showGlobalBar);

  if (!showCard || !session?.batch || !view) {
    return (
      <div className="ig-panel flex h-full min-h-[220px] flex-col p-5">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-ig-text">Upload em andamento</h2>
        </div>
        <div className="flex flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-ig-border bg-ig-secondary/50 px-4 py-8 text-center">
          <Upload size={28} className="mb-3 text-ig-muted" strokeWidth={1.5} />
          <p className="text-sm text-ig-muted">Nenhum upload ativo no momento.</p>
          <Link href="/dashboard/bulk" className="ig-btn mt-4 px-4 py-2 text-sm">
            Enviar vídeos
          </Link>
        </div>
      </div>
    );
  }

  const fileName = view.currentUploadName ?? activeFile?.filename ?? "Enviando vídeos…";
  const fileSize = activeFile ? formatBytes(Number(activeFile.file_size)) : null;
  const filePercent = activeFile
    ? (session.progressMap[activeFile.id] ??
      (activeFile.status === "completed" ? 100 : activeFile.status === "uploading" ? 5 : 0))
    : view.overallPercent;

  const statusLabel = session.running
    ? "ENVIANDO"
    : session.paused
      ? "PAUSADO"
      : view.failedCount > 0
        ? "COM ERRO"
        : "AGUARDANDO";

  return (
    <div className="ig-panel flex h-full min-h-[220px] flex-col p-5">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-ig-text">Upload em andamento</h2>
        <Link
          href="/dashboard/bulk"
          className="inline-flex items-center gap-1 text-xs font-medium text-ig-primary hover:underline"
        >
          Ver upload
          <ExternalLink size={12} />
        </Link>
      </div>

      <div className="flex-1 rounded-xl border border-ig-border bg-ig-secondary/40 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-ig-text">{fileName}</p>
            <p className="mt-1 text-xs text-ig-muted">
              {fileSize ? `Tamanho: ${fileSize}` : "Preparando envio…"}
              {fileSize ? ` · ${filePercent}% concluído` : ""}
            </p>
          </div>
          <span className="shrink-0 rounded-md bg-ig-primary/15 px-2 py-0.5 text-[10px] font-bold tracking-wide text-ig-primary">
            {statusLabel}
          </span>
        </div>

        <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-ig-elevated">
          <div
            className="h-full rounded-full bg-ig-primary transition-[width] duration-300"
            style={{ width: `${Math.max(filePercent, view.overallPercent, 2)}%` }}
          />
        </div>

        <p className="mt-3 text-xs text-ig-muted">
          {session.resuming && (
            <span className="inline-flex items-center gap-1">
              <Loader2 size={12} className="animate-spin" />
              Reconhecendo arquivos…
            </span>
          )}
          {!session.resuming && (
            <>
              {view.completedCount} de {view.totalCount} vídeos · Lote #{session.batch.batch_number}
              {view.failedCount > 0 ? ` · ${view.failedCount} erro(s)` : ""}
            </>
          )}
        </p>
      </div>
    </div>
  );
}
