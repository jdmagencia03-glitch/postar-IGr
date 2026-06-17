"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, RefreshCw, Upload } from "lucide-react";
import { buildFileFingerprint, validateFiles } from "@/lib/upload/validate";
import {
  cancelUploadBatch,
  createUploadBatch,
  fetchActiveBatch,
  fileStatusLabel,
  getCompletedUploadItems,
  matchFileToRecord,
  refreshUploadBatch,
  uploadBatchFile,
} from "@/lib/upload/client";
import type { UploadBatch, UploadBatchFile } from "@/lib/types";

interface Props {
  accountId: string;
  scheduleMode: UploadBatch["schedule_mode"];
  customSchedule?: UploadBatch["custom_schedule"];
  onBatchUpdate?: (batch: UploadBatch | null) => void;
  onUploadingChange?: (uploading: boolean) => void;
}

export function UploadBatchManager({
  accountId,
  scheduleMode,
  customSchedule,
  onBatchUpdate,
  onUploadingChange,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const resumeInputRef = useRef<HTMLInputElement>(null);
  const retryFileIdRef = useRef<string | null>(null);
  const [batch, setBatch] = useState<UploadBatch | null>(null);
  const [loadingBatch, setLoadingBatch] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [progressMap, setProgressMap] = useState<Record<string, number>>({});
  const [message, setMessage] = useState<string | null>(null);

  const syncBatch = useCallback(
    (next: UploadBatch | null) => {
      setBatch(next);
      onBatchUpdate?.(next);
    },
    [onBatchUpdate],
  );

  const loadActiveBatch = useCallback(async () => {
    setLoadingBatch(true);
    try {
      const active = await fetchActiveBatch();
      syncBatch(active);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Erro ao carregar lote");
    } finally {
      setLoadingBatch(false);
    }
  }, [syncBatch]);

  useEffect(() => {
    loadActiveBatch();
  }, [loadActiveBatch]);

  useEffect(() => {
    onUploadingChange?.(uploading);
  }, [uploading, onUploadingChange]);

  async function runUploadQueue(
    files: File[],
    currentBatch: UploadBatch,
    onlyFileId?: string | null,
  ) {
    setUploading(true);
    setMessage(null);

    const records = [...(currentBatch.upload_files ?? [])]
      .filter((record) => !onlyFileId || record.id === onlyFileId)
      .sort((a, b) => a.sort_order - b.sort_order);

    let latestBatch = currentBatch;

    for (const record of records) {
      if (record.status === "completed") continue;

      const file = files.find((candidate) => matchFileToRecord(candidate, [record]));
      if (!file) continue;

      try {
        latestBatch = await uploadBatchFile({
          batch: latestBatch,
          record,
          file,
          onProgress: (loaded, total) => {
            setProgressMap((current) => ({
              ...current,
              [record.id]: Math.round((loaded / total) * 100),
            }));
          },
        });
        syncBatch(latestBatch);
      } catch (error) {
        latestBatch = await refreshUploadBatch(latestBatch.id);
        syncBatch(latestBatch);
        setMessage(error instanceof Error ? error.message : "Erro no upload");
      }
    }

    latestBatch = await refreshUploadBatch(latestBatch.id);
    syncBatch(latestBatch);
    setUploading(false);
  }

  async function handleNewFiles(selected: FileList | null) {
    if (!selected?.length || !accountId) return;

    setUploading(true);
    setMessage(null);

    try {
      const fileArray = Array.from(selected);
      const validated = validateFiles(fileArray).valid;
      const created = await createUploadBatch({
        accountId,
        scheduleMode,
        customSchedule,
        files: validated,
      });
      syncBatch(created);
      await runUploadQueue(validated.map((item) => item.file), created);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Erro ao iniciar upload");
      setUploading(false);
    }
  }

  async function handleResumeFiles(selected: FileList | null) {
    if (!selected?.length || !batch) return;
    const onlyFileId = retryFileIdRef.current;
    retryFileIdRef.current = null;
    await runUploadQueue(Array.from(selected), batch, onlyFileId);
  }

  async function retryFile(record: UploadBatchFile) {
    if (!batch) return;
    retryFileIdRef.current = record.id;
    resumeInputRef.current?.click();
    setMessage(`Selecione o arquivo ${record.filename} para tentar novamente.`);
  }

  async function handleCancelBatch() {
    if (!batch) return;
    if (!window.confirm("Cancelar este lote? Os vídeos já enviados serão descartados deste lote.")) {
      return;
    }

    try {
      await cancelUploadBatch(batch.id);
      syncBatch(null);
      setProgressMap({});
      setMessage("Lote cancelado.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Erro ao cancelar lote");
    }
  }

  const files = batch?.upload_files ?? [];
  const completedCount = batch?.completed_files ?? 0;
  const totalCount = batch?.total_files ?? files.length;
  const username = batch?.instagram_accounts?.ig_username;

  if (loadingBatch) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-ig-border bg-ig-secondary px-4 py-6 text-sm text-ig-muted">
        <Loader2 size={16} className="animate-spin" />
        Carregando lote...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {batch && (
        <div className="rounded-xl border border-ig-info-border bg-ig-info-bg px-4 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              {batch.status === "ready" ? (
                <>
                  <p className="text-sm font-semibold text-ig-text">
                    Lote #{batch.batch_number} — Pronto para agendar
                  </p>
                  <p className="mt-1 text-sm text-ig-muted">
                    Conta: @{username ?? "conta"} · {completedCount} de {totalCount} vídeos enviados
                  </p>
                </>
              ) : (
                <>
                  <p className="text-sm font-semibold text-ig-text">Você tem um upload em andamento.</p>
                  <p className="mt-1 text-sm text-ig-muted">
                    {completedCount} de {totalCount} vídeos enviados.
                  </p>
                  <p className="mt-1 text-xs text-ig-muted">
                    Lote #{batch.batch_number} · @{username ?? "conta"}
                  </p>
                </>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {!uploading && batch.status !== "ready" && (
                <button
                  type="button"
                  onClick={() => resumeInputRef.current?.click()}
                  className="ig-btn-secondary px-3 py-2 text-sm"
                >
                  Continuar upload
                </button>
              )}
              {!uploading && (
                <button
                  type="button"
                  onClick={handleCancelBatch}
                  className="rounded-lg border border-ig-border px-3 py-2 text-sm text-ig-muted hover:bg-ig-secondary"
                >
                  Cancelar lote
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {!batch && (
        <div
          className="rounded-2xl border-2 border-dashed border-ig-border bg-ig-secondary px-4 py-10 text-center"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            handleNewFiles(event.dataTransfer.files);
          }}
        >
          <p className="text-3xl">📤</p>
          <p className="mt-3 text-base font-medium text-ig-text">Arraste seus vídeos aqui</p>
          <p className="my-3 text-sm text-ig-muted">ou</p>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="ig-btn-secondary inline-flex items-center gap-2 px-4 py-2 text-sm disabled:opacity-50"
          >
            <Upload size={16} />
            Selecionar vídeos
          </button>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="video/*"
        multiple
        className="hidden"
        onChange={(event) => {
          handleNewFiles(event.target.files);
          event.target.value = "";
        }}
      />

      <input
        ref={resumeInputRef}
        type="file"
        accept="video/*"
        multiple
        className="hidden"
        onChange={(event) => {
          handleResumeFiles(event.target.files);
          event.target.value = "";
        }}
      />

      {files.length > 0 && (
        <div className="rounded-xl border border-ig-border bg-ig-elevated p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-sm font-medium text-ig-text">Status por vídeo</p>
            {!uploading && batch?.status !== "ready" && (
              <button
                type="button"
                onClick={() => resumeInputRef.current?.click()}
                className="inline-flex items-center gap-1 text-xs text-ig-primary hover:underline"
              >
                <RefreshCw size={12} />
                Continuar envio
              </button>
            )}
          </div>

          <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
            {files
              .slice()
              .sort((a, b) => a.sort_order - b.sort_order)
              .map((file) => {
                const progress = progressMap[file.id] ?? 0;
                return (
                  <div
                    key={file.id}
                    className="rounded-lg border border-ig-border bg-ig-secondary px-3 py-2 text-sm"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="truncate text-ig-text">{file.filename}</span>
                      <span className="text-ig-muted">— {fileStatusLabel(file.status)}</span>
                    </div>
                    {file.status === "uploading" && (
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-ig-elevated">
                        <div
                          className="h-full rounded-full bg-ig-primary transition-all"
                          style={{ width: `${progress || 10}%` }}
                        />
                      </div>
                    )}
                    {file.status === "failed" && (
                      <button
                        type="button"
                        onClick={() => retryFile(file)}
                        className="mt-2 text-xs font-medium text-ig-primary hover:underline"
                      >
                        Tentar novamente
                      </button>
                    )}
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {batch && completedCount > 0 && (
        <p className="text-sm text-ig-muted">
          {getCompletedUploadItems(batch).length} vídeo(s) já salvos neste lote.
          {batch.status !== "ready" && " Você pode agendar os enviados agora ou continuar o restante depois."}
        </p>
      )}

      {uploading && (
        <div className="flex items-center gap-2 text-sm text-ig-primary">
          <Loader2 size={16} className="animate-spin" />
          Upload em andamento... não feche esta página.
        </div>
      )}

      {message && (
        <p className={`text-sm ${message.includes("Erro") || message.includes("Falha") ? "text-ig-danger" : "text-ig-text"}`}>
          {message}
        </p>
      )}
    </div>
  );
}

export { getCompletedUploadItems };
