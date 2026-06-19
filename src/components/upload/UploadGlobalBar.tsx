"use client";

import { memo, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Loader2,
  Pause,
  Play,
  Upload,
} from "lucide-react";
import { useOptionalUploadSession } from "@/contexts/UploadSessionProvider";
import { deriveUploadSessionView } from "@/lib/upload/session-derived";
import { uploadSessionStore } from "@/lib/upload/session-store";
import { fileStatusLabel } from "@/lib/upload/client";
import { displayUploadErrorMessage } from "@/lib/upload/errors";
import { formatBytes, formatEta, formatSpeed } from "@/lib/upload/validate";
import { getSpeedPresets } from "@/lib/upload/storage-config";
import type { UploadBatchFile } from "@/lib/types";

function statusBadge(label: string) {
  switch (label) {
    case "enviando":
      return "bg-ig-primary/15 text-ig-primary";
    case "reconectando":
      return "bg-amber-500/15 text-amber-600 dark:text-amber-400";
    case "concluído":
      return "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400";
    case "erro":
      return "bg-ig-danger/15 text-ig-danger";
    case "pausado":
      return "bg-ig-secondary text-ig-muted";
    default:
      return "bg-ig-secondary text-ig-muted";
  }
}

function statusText(label: string) {
  switch (label) {
    case "enviando":
      return "Enviando";
    case "reconectando":
      return "Reconectando";
    case "concluído":
      return "Concluído";
    case "erro":
      return "Com erro";
    case "pausado":
      return "Pausado";
    default:
      return "Aguardando";
  }
}

const QueueRow = memo(function QueueRow({
  file,
  percent,
  maxUploadBytes,
}: {
  file: UploadBatchFile;
  percent: number;
  maxUploadBytes: number;
}) {
  const errorText = displayUploadErrorMessage(
    file.error_message,
    Number(file.file_size),
    maxUploadBytes,
  );

  return (
    <div className="rounded-lg border border-ig-border bg-ig-secondary px-3 py-2 text-xs">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-ig-text">{file.filename}</span>
        <span className="shrink-0 text-ig-muted">
          {fileStatusLabel(file.status, {
            retrying: file.status === "retrying",
          })}
        </span>
      </div>
      {(file.status === "uploading" || file.status === "retrying") && (
        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-ig-elevated">
          <div className="h-full bg-ig-primary" style={{ width: `${percent || 5}%` }} />
        </div>
      )}
      {file.status === "failed" && errorText && (
        <p className="mt-1 text-ig-danger">{errorText}</p>
      )}
    </div>
  );
});

export const UploadGlobalBar = memo(function UploadGlobalBar() {
  const pathname = usePathname();
  const session = useOptionalUploadSession();
  const [expanded, setExpanded] = useState(false);

  const view = useMemo(() => {
    if (!session) return null;
    return deriveUploadSessionView({
      batch: session.batch,
      progress: session.progress,
      progressMap: session.progressMap,
      running: session.running,
      pausedByUser: session.pausedByUser,
      retrying: session.retrying,
      resuming: session.resuming,
      canResumeWithoutPicker: session.canResumeWithoutPicker,
      needsFileReselection: session.needsFileReselection,
      fileRuntime: session.fileRuntime,
      engineStarting: session.engineStarting,
      recoveringFromStall: session.recoveringFromStall,
      batchStalled: session.batchStalled,
    });
  }, [session]);

  const hasFileRetry = Boolean(
    session && Object.values(session.fileRuntime).some((runtime) => runtime.status === "retrying"),
  );

  if (!session || !view?.showGlobalBar || !session.batch) return null;

  // Na home o upload aparece no card inline — evita barra duplicada.
  if (pathname === "/dashboard") return null;

  const maxUploadBytes = (session.uploadLimits?.max_upload_mb ?? 500) * 1024 * 1024;
  const speedPresets =
    session.uploadLimits?.speed_presets ?? getSpeedPresets(session.uploadLimits?.concurrency);
  const username = session.batch.instagram_accounts?.ig_username ?? "conta";

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center p-3 sm:p-4">
      <div className="pointer-events-auto w-full max-w-2xl rounded-2xl border border-ig-border bg-ig-elevated/95 shadow-lg backdrop-blur-md">
        <div className="px-4 py-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-semibold text-ig-text">
                  Upload em andamento · Lote #{session.batch.batch_number}
                </p>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${statusBadge(view.statusLabel)}`}
                >
                  {statusText(view.statusLabel)}
                </span>
              </div>
              <p className="mt-1 truncate text-xs text-ig-muted">
                {view.isActivelyUploading
                  ? view.currentUploadName
                    ? `Enviando: ${view.currentUploadName}`
                    : `@${username} · ${speedPresets[session.speedMode].label}`
                  : hasFileRetry || session.retrying || view.awaitingAutoRecovery
                    ? session.message ?? "Retomando envio…"
                    : view.currentUploadName
                      ? `Enviando: ${view.currentUploadName}`
                      : `@${username} · ${speedPresets[session.speedMode].label}`}
              </p>
              <p className="mt-1 text-xs text-ig-muted">
                {view.completedCount} enviados
                {view.failedCount > 0 ? ` · ${view.failedCount} falharam` : ""}
                {view.queueRemaining > 0 ? ` · ${view.queueRemaining} pendentes` : ""}
                {" · "}
                {view.overallPercent}%
              </p>
            </div>

            <div className="flex shrink-0 items-center gap-1.5">
              {session.running && (
                <button
                  type="button"
                  className="rounded-lg border border-ig-border px-2.5 py-1.5 text-xs text-ig-text hover:bg-ig-secondary"
                  onClick={() => void uploadSessionStore.togglePause()}
                >
                  <Pause size={14} />
                </button>
              )}
              {view.canResume && !session.running && !session.retrying && (
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-lg bg-ig-primary px-2.5 py-1.5 text-xs text-ig-on-primary"
                  onClick={() => void uploadSessionStore.resumePausedUpload()}
                >
                  <Play size={14} />
                  Retomar
                </button>
              )}
              {view.canSelectFiles && !session.running && !session.retrying && (
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-lg bg-ig-primary px-2.5 py-1.5 text-xs text-ig-on-primary"
                  onClick={() => uploadSessionStore.openChooseVideos()}
                >
                  <Upload size={14} />
                  Selecionar
                </button>
              )}
              {view.showRecoverButton && !session.running && (
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-lg bg-ig-primary px-2.5 py-1.5 text-xs text-ig-on-primary"
                  onClick={() => void uploadSessionStore.recoverBatchUpload("manual_recover")}
                >
                  Recuperar
                </button>
              )}
              <Link
                href="/dashboard/bulk"
                className="inline-flex items-center gap-1 rounded-lg border border-ig-border px-2.5 py-1.5 text-xs text-ig-text hover:bg-ig-secondary"
              >
                <ExternalLink size={12} />
                Ver upload
              </Link>
              <button
                type="button"
                aria-expanded={expanded}
                className="rounded-lg border border-ig-border px-2.5 py-1.5 text-xs text-ig-muted hover:bg-ig-secondary"
                onClick={() => setExpanded((value) => !value)}
              >
                {expanded ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
              </button>
            </div>
          </div>

          <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-ig-secondary">
            <div
              className="h-full rounded-full bg-ig-primary transition-none"
              style={{ width: `${view.overallPercent}%` }}
            />
          </div>

          {session.progress && (session.running || session.retrying) && (
            <p className="mt-2 text-[11px] text-ig-muted">
              {formatSpeed(session.progress.speedBps)} · restam {formatEta(session.progress.etaSeconds)} ·{" "}
              {formatBytes(session.progress.bytesUploaded)} / {formatBytes(session.progress.bytesTotal)}
            </p>
          )}
        </div>

        {expanded && (
          <div className="max-h-56 overflow-y-auto border-t border-ig-border px-4 py-3">
            <p className="mb-2 text-xs font-medium text-ig-text">Fila de upload</p>
            <div className="space-y-1.5">
              {view.listFiles.slice(0, 30).map((file) => (
                <QueueRow
                  key={file.id}
                  file={file}
                  percent={session.progressMap[file.id] ?? (file.status === "completed" ? 100 : 0)}
                  maxUploadBytes={maxUploadBytes}
                />
              ))}
              {view.listFiles.length > 30 && (
                <p className="text-[11px] text-ig-muted">… e mais {view.listFiles.length - 30} vídeo(s)</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
});
