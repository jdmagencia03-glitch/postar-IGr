"use client";

import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Pause, Play, Upload, X } from "lucide-react";
import { useOptionalUploadContext } from "@/contexts/UploadContext";
import {
  buildFileMapFromRecords,
  cancelUploadBatch,
  createUploadBatch,
  fetchActiveBatch,
  fileStatusLabel,
  getCompletedUploadItems,
  refreshUploadBatch,
  setBatchPaused,
} from "@/lib/upload/client";
import { UploadEngine, SPEED_PRESETS, type UploadEngineProgress } from "@/lib/upload/engine";
import {
  clearManifestBatch,
  getManifestForBatch,
  matchFilesToManifest,
  saveManifestEntries,
} from "@/lib/upload/manifest-store";
import {
  formatBytes,
  formatEta,
  formatSpeed,
  validateFiles,
  type DuplicateFile,
  type InvalidFile,
} from "@/lib/upload/validate";
import type { UploadBatch, UploadBatchFile, UploadSpeedMode } from "@/lib/types";

interface Props {
  accountId: string;
  scheduleMode: UploadBatch["schedule_mode"];
  customSchedule?: UploadBatch["custom_schedule"];
  onBatchUpdate?: (batch: UploadBatch | null) => void;
  onUploadingChange?: (uploading: boolean) => void;
  onSchedulePartial?: () => void;
}

const FileStatusRow = memo(function FileStatusRow({
  file,
  percent,
  onRetry,
}: {
  file: UploadBatchFile;
  percent: number;
  onRetry: (file: UploadBatchFile) => void;
}) {
  return (
    <div className="rounded-lg border border-ig-border bg-ig-secondary px-3 py-2 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="truncate text-ig-text">{file.filename}</span>
        <span className="text-xs text-ig-muted">
          {formatBytes(Number(file.file_size))} · {fileStatusLabel(file.status)}
        </span>
      </div>
      {(file.status === "uploading" || percent > 0) && file.status !== "completed" && (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-ig-elevated">
          <div className="h-full rounded-full bg-ig-primary" style={{ width: `${percent || 5}%` }} />
        </div>
      )}
      {file.status === "failed" && (
        <button
          type="button"
          onClick={() => onRetry(file)}
          className="mt-2 text-xs font-medium text-ig-primary hover:underline"
        >
          Tentar novamente
        </button>
      )}
    </div>
  );
});

export function SupremeUploadManager({
  accountId,
  scheduleMode,
  customSchedule,
  onBatchUpdate,
  onUploadingChange,
  onSchedulePartial,
}: Props) {
  const uploadContext = useOptionalUploadContext();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const resumeInputRef = useRef<HTMLInputElement>(null);
  const engineRef = useRef<UploadEngine | null>(null);
  const retryFileIdRef = useRef<string | null>(null);
  const onBatchUpdateRef = useRef(onBatchUpdate);
  const onUploadingChangeRef = useRef(onUploadingChange);
  const uploadContextRef = useRef(uploadContext);
  const progressFrameRef = useRef<number | null>(null);
  const pendingProgressRef = useRef<UploadEngineProgress | null>(null);

  useEffect(() => {
    onBatchUpdateRef.current = onBatchUpdate;
    onUploadingChangeRef.current = onUploadingChange;
    uploadContextRef.current = uploadContext;
  });

  const [batch, setBatch] = useState<UploadBatch | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [speedMode, setSpeedMode] = useState<UploadSpeedMode>("normal");
  const [progress, setProgress] = useState<UploadEngineProgress | null>(null);
  const [progressMap, setProgressMap] = useState<Record<string, number>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [resuming, setResuming] = useState(false);
  const [validationPreview, setValidationPreview] = useState<{
    validCount: number;
    invalid: InvalidFile[];
    duplicates: DuplicateFile[];
    pendingFiles: File[];
  } | null>(null);

  const syncBatch = useCallback((next: UploadBatch | null) => {
    setBatch(next);
    onBatchUpdateRef.current?.(next);
    uploadContextRef.current?.setBatchNumber(next?.batch_number ?? null);
  }, []);

  const flushProgress = useCallback(() => {
    progressFrameRef.current = null;
    const pending = pendingProgressRef.current;
    if (!pending) return;
    setProgress(pending);
    uploadContextRef.current?.setProgress(pending);
  }, []);

  const scheduleProgressUpdate = useCallback(
    (next: UploadEngineProgress) => {
      pendingProgressRef.current = next;
      if (progressFrameRef.current !== null) return;
      progressFrameRef.current = requestAnimationFrame(flushProgress);
    },
    [flushProgress],
  );

  useEffect(() => {
    let cancelled = false;

    async function loadInitialBatch() {
      setInitialLoading(true);
      try {
        const active = await fetchActiveBatch();
        if (cancelled) return;

        syncBatch(active);
        if (active?.upload_speed_mode) setSpeedMode(active.upload_speed_mode);
        if (active?.paused) setPaused(true);
        if (active?.upload_files?.length) {
          const initialProgress: Record<string, number> = {};
          for (const file of active.upload_files) {
            const uploaded = Number(file.bytes_uploaded ?? 0);
            const total = Number(file.file_size);
            if (uploaded > 0 && total > 0 && file.status !== "completed") {
              initialProgress[file.id] = Math.round((uploaded / total) * 100);
            }
          }
          setProgressMap(initialProgress);
        }
      } catch (error) {
        if (!cancelled) {
          setMessage(error instanceof Error ? error.message : "Erro ao carregar lote");
        }
      } finally {
        if (!cancelled) setInitialLoading(false);
      }
    }

    loadInitialBatch();
    return () => {
      cancelled = true;
      if (progressFrameRef.current !== null) {
        cancelAnimationFrame(progressFrameRef.current);
      }
    };
  }, [accountId, syncBatch]);

  useEffect(() => {
    onUploadingChangeRef.current?.(running);
    uploadContextRef.current?.setIsActive(running || Boolean(batch && batch.status !== "ready"));
  }, [running, batch]);

  useEffect(() => {
    if (!running && !batch) return;

    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue =
        "Seus vídeos ainda estão sendo enviados. Você pode sair, mas o upload será pausado. Ao voltar, poderá continuar de onde parou.";
    };

    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [running, batch]);

  async function startEngine(currentBatch: UploadBatch, fileMap: Map<string, File>, onlyFileIds?: string[]) {
    engineRef.current?.stop();
    const engine = new UploadEngine(speedMode, {
      onProgress: scheduleProgressUpdate,
      onBatchUpdate: syncBatch,
      onFileProgress: (fileId, loaded, total) => {
        const percent = Math.round((loaded / total) * 100);
        setProgressMap((current) => {
          if (current[fileId] === percent) return current;
          return { ...current, [fileId]: percent };
        });
      },
      onComplete: async (latest) => {
        const refreshed = await refreshUploadBatch(latest.id);
        syncBatch(refreshed);
        setRunning(false);
        setPaused(false);
        uploadContextRef.current?.setIsActive(false);
        if (refreshed.status === "ready") {
          setMessage("Upload concluído com sucesso. A IA pode agendar suas publicações.");
        }
      },
      onError: (errorMessage) => setMessage(errorMessage),
    });

    engineRef.current = engine;
    setRunning(true);
    setPaused(false);
    uploadContextRef.current?.setIsActive(true);

    await engine.run({ batch: currentBatch, fileMap, onlyFileIds });
    setRunning(false);
  }

  async function handleValidatedUpload(files: File[], skipDuplicates = true) {
    if (!accountId) return;

    const existingHashes = new Set(
      (batch?.upload_files ?? []).map((file) => file.file_hash).filter(Boolean) as string[],
    );
    const validation = validateFiles(files, existingHashes);

    const toUpload = skipDuplicates ? validation.valid : [...validation.valid, ...validation.duplicates.map((d) => ({ file: d.file, fingerprint: d.fingerprint }))];

    if (!toUpload.length) {
      setValidationPreview({
        validCount: 0,
        invalid: validation.invalid,
        duplicates: validation.duplicates,
        pendingFiles: [],
      });
      return;
    }

    setValidationPreview(null);
    setMessage(null);

    try {
      let currentBatch = batch;

      if (!currentBatch) {
        currentBatch = await createUploadBatch({
          accountId,
          scheduleMode,
          customSchedule,
          uploadSpeedMode: speedMode,
          files: toUpload,
        });
        syncBatch(currentBatch);

        await saveManifestEntries(
          toUpload.map(({ file, fingerprint }) => {
            const record = currentBatch!.upload_files!.find(
              (item) => item.file_hash === fingerprint || item.filename === file.name,
            )!;
            return {
              fileId: record.id,
              batchId: currentBatch!.id,
              name: file.name,
              size: file.size,
              lastModified: file.lastModified,
              fingerprint,
            };
          }),
        );
      }

      const fileMap = new Map<string, File>();
      for (const { file, fingerprint } of toUpload) {
        const record = currentBatch.upload_files?.find(
          (item) => item.file_hash === fingerprint || item.filename === file.name,
        );
        if (record) fileMap.set(record.id, file);
      }

      await startEngine(currentBatch, fileMap);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Erro ao iniciar upload");
      setRunning(false);
    }
  }

  function handleFileSelection(selected: FileList | null) {
    if (!selected?.length) return;
    const files = Array.from(selected);
    const validation = validateFiles(files);
    setValidationPreview({
      validCount: validation.valid.length,
      invalid: validation.invalid,
      duplicates: validation.duplicates,
      pendingFiles: validation.valid.map((item) => item.file),
    });
  }

  async function handleResume(selected: FileList | null) {
    if (!selected?.length || !batch) return;

    setResuming(true);
    setMessage("Reconhecendo arquivos selecionados...");

    try {
      const files = Array.from(selected).filter((file) => file.type.startsWith("video/") || /\.(mp4|mov|webm)$/i.test(file.name));
      if (!files.length) {
        setMessage("Nenhum vídeo encontrado na seleção.");
        return;
      }

      const manifest = await getManifestForBatch(batch.id);
      const fromManifest = matchFilesToManifest(files, manifest);
      const fromRecords = buildFileMapFromRecords(files, batch.upload_files ?? []);
      const fileMap = new Map([...fromManifest, ...fromRecords]);

      const pendingRecords = (batch.upload_files ?? []).filter(
        (record) => !record.removed && record.status !== "completed",
      );
      const matchedPending = pendingRecords.filter((record) => fileMap.has(record.id)).length;
      const alreadyDone = (batch.upload_files ?? []).filter((record) => record.status === "completed").length;

      if (matchedPending === 0) {
        setMessage(
          `Nenhum vídeo pendente foi reconhecido. Selecione a mesma pasta/arquivos do lote (${alreadyDone} já enviados).`,
        );
        return;
      }

      setPaused(false);
      await setBatchPaused(batch.id, false);

      setMessage(
        `${fileMap.size} arquivo(s) reconhecido(s) · ${alreadyDone} já enviados · retomando ${matchedPending} pendente(s). Os concluídos não serão reenviados.`,
      );

      const onlyFileId = retryFileIdRef.current;
      retryFileIdRef.current = null;

      if (onlyFileId && fileMap.has(onlyFileId)) {
        await startEngine(batch, fileMap, [onlyFileId]);
        return;
      }

      await startEngine(batch, fileMap);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Erro ao retomar upload");
      setRunning(false);
    } finally {
      setResuming(false);
    }
  }

  async function togglePause() {
    if (!batch) return;

    if (running && !paused) {
      engineRef.current?.pause();
      setPaused(true);
      setRunning(false);
      await setBatchPaused(batch.id, true);
      setMessage("Upload pausado. Seu progresso foi salvo.");
      return;
    }

    setPaused(false);
    await setBatchPaused(batch.id, false);
    resumeInputRef.current?.click();
  }

  async function handleCancelBatch() {
    if (!batch) return;
    if (!window.confirm("Cancelar este lote? Os vídeos já enviados serão descartados deste lote.")) {
      return;
    }

    engineRef.current?.stop();
    try {
      await cancelUploadBatch(batch.id);
      await clearManifestBatch(batch.id);
      syncBatch(null);
      setProgress(null);
      setProgressMap({});
      setRunning(false);
      setPaused(false);
      uploadContextRef.current?.setIsActive(false);
      uploadContextRef.current?.setProgress(null);
      setMessage("Lote cancelado.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Erro ao cancelar lote");
    }
  }

  function retryFile(record: UploadBatchFile) {
    retryFileIdRef.current = record.id;
    resumeInputRef.current?.click();
    setMessage(`Selecione novamente: ${record.filename}`);
  }

  const files = batch?.upload_files?.filter((file) => !file.removed) ?? [];
  const completedCount = progress?.completed ?? batch?.completed_files ?? 0;
  const totalCount = progress?.total ?? batch?.total_files ?? files.length;
  const failedCount = progress?.failed ?? batch?.failed_files ?? 0;
  const username = batch?.instagram_accounts?.ig_username;
  const overallPercent = progress?.overallPercent ?? (totalCount ? Math.round((completedCount / totalCount) * 100) : 0);

  const visibleFiles = files
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order)
    .filter(
      (file) =>
        file.status === "uploading" ||
        file.status === "failed" ||
        file.status === "pending" ||
        (progressMap[file.id] ?? 0) > 0,
    );
  const completedOnlyFiles = files
    .filter((file) => file.status === "completed")
    .sort((a, b) => a.sort_order - b.sort_order);
  const listFiles = visibleFiles.length > 0 ? visibleFiles : completedOnlyFiles.slice(-20);

  if (initialLoading) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-ig-border bg-ig-secondary px-4 py-6 text-sm text-ig-muted">
        <Loader2 size={16} className="animate-spin" />
        Carregando sistema de upload...
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {!batch && !validationPreview && (
        <div className="space-y-3">
          <div
            className="rounded-2xl border-2 border-dashed border-ig-border bg-ig-secondary px-4 py-12 text-center"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              handleFileSelection(event.dataTransfer.files);
            }}
          >
            <p className="text-3xl">🚀</p>
            <p className="mt-3 text-lg font-semibold text-ig-text">Arraste seus vídeos aqui</p>
            <p className="mt-2 text-sm text-ig-muted">ou</p>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="ig-btn-secondary mt-3 inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold"
            >
              <Upload size={16} />
              Selecionar vídeos
            </button>
            <p className="mt-4 text-xs text-ig-muted">MP4, MOV, WEBM · até 500MB por vídeo</p>
          </div>

          <p className="rounded-xl border border-ig-info-border bg-ig-info-bg px-4 py-3 text-sm text-ig-muted">
            Upload em chunks de 6MB com retomada byte-a-byte. Se a internet cair ou você sair da página, selecione os mesmos vídeos e continue de onde parou — nada recomeça do zero.
          </p>

          <div>
            <p className="mb-2 text-sm font-medium text-ig-text">Velocidade de upload</p>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(SPEED_PRESETS) as UploadSpeedMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setSpeedMode(mode)}
                  className={`rounded-full px-4 py-2 text-sm ${
                    speedMode === mode
                      ? "bg-ig-primary text-ig-on-primary"
                      : "border border-ig-border bg-ig-secondary text-ig-text"
                  }`}
                >
                  {SPEED_PRESETS[mode].label}
                </button>
              ))}
            </div>
            <p className="mt-1 text-xs text-ig-muted">{SPEED_PRESETS[speedMode].description}</p>
          </div>
        </div>
      )}

      {validationPreview && (
        <div className="rounded-2xl border border-ig-border bg-ig-elevated p-5">
          <p className="text-lg font-semibold text-ig-text">
            {validationPreview.validCount + validationPreview.duplicates.length} arquivos selecionados
          </p>
          <div className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
            <p className="text-ig-text">{validationPreview.validCount} válidos</p>
            <p className="text-ig-muted">{validationPreview.duplicates.length} duplicados</p>
            <p className="text-ig-danger">{validationPreview.invalid.length} inválidos</p>
          </div>
          {validationPreview.invalid.length > 0 && (
            <ul className="mt-3 max-h-24 space-y-1 overflow-y-auto text-xs text-ig-danger">
              {validationPreview.invalid.slice(0, 8).map((item) => (
                <li key={`${item.file.name}-${item.file.size}`}>
                  {item.file.name}: {item.reason}
                </li>
              ))}
            </ul>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              className="ig-btn px-4 py-2 text-sm"
              disabled={!validationPreview.validCount}
              onClick={() => handleValidatedUpload(validationPreview.pendingFiles, true)}
            >
              Enviar apenas válidos ({validationPreview.validCount})
            </button>
            <button
              type="button"
              className="ig-btn-secondary px-4 py-2 text-sm"
              onClick={() => setValidationPreview(null)}
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {batch && (
        <>
          <div className="rounded-2xl border border-ig-info-border bg-ig-info-bg p-5">
            {batch.status === "ready" ? (
              <>
                <p className="text-lg font-semibold text-ig-text">Upload concluído com sucesso</p>
                <p className="mt-1 text-sm text-ig-muted">
                  {completedCount} vídeos enviados · Lote #{batch.batch_number} · @{username}
                </p>
              </>
            ) : (
              <>
                <p className="text-lg font-semibold text-ig-text">
                  {paused ? "Upload pausado" : "Upload em andamento"}
                </p>
                <p className="mt-1 text-sm text-ig-muted">
                  {completedCount} de {totalCount} vídeos enviados
                  {failedCount > 0 && ` · ${failedCount} falha(s)`}
                </p>
                <p className="mt-1 text-xs text-ig-muted">
                  Nenhum vídeo enviado será perdido. Lote #{batch.batch_number} · @{username}
                </p>
                {paused && !running && (
                  <p className="mt-2 rounded-lg border border-ig-border bg-ig-secondary px-3 py-2 text-xs text-ig-muted">
                    Para continuar, clique em <strong className="text-ig-text">Continuar</strong> e selecione a{" "}
                    <strong className="text-ig-text">mesma pasta</strong> com os {totalCount} vídeos. Os{" "}
                    {completedCount} já enviados não serão reenviados.
                  </p>
                )}
              </>
            )}

            {batch.status !== "ready" && (
              <div className="mt-4">
                <div className="mb-2 flex items-center justify-between text-sm">
                  <span className="text-ig-muted">Progresso geral</span>
                  <span className="font-semibold text-ig-text">{overallPercent}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-ig-secondary">
                  <div
                    className={`h-full rounded-full bg-ig-primary ${running ? "" : "transition-all"}`}
                    style={{ width: `${overallPercent}%` }}
                  />
                </div>
                {progress && (
                  <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                    <p className="text-ig-muted">
                      Velocidade: <span className="text-ig-text">{formatSpeed(progress.speedBps)}</span>
                    </p>
                    <p className="text-ig-muted">
                      Tempo restante: <span className="text-ig-text">{formatEta(progress.etaSeconds)}</span>
                    </p>
                    <p className="text-ig-muted">
                      Enviados: <span className="text-ig-text">{formatBytes(progress.bytesUploaded)}</span>
                    </p>
                    <p className="text-ig-muted">
                      Total: <span className="text-ig-text">{formatBytes(progress.bytesTotal)}</span>
                    </p>
                  </div>
                )}
              </div>
            )}

            <div className="mt-4 flex flex-wrap gap-2">
              {batch.status !== "ready" && !running && !paused && (
                <button
                  type="button"
                  className="ig-btn-secondary px-3 py-2 text-sm"
                  disabled={resuming}
                  onClick={() => resumeInputRef.current?.click()}
                >
                  Selecionar pasta para continuar
                </button>
              )}
              {running && (
                <button type="button" className="ig-btn-secondary inline-flex items-center gap-2 px-3 py-2 text-sm" onClick={togglePause}>
                  <Pause size={14} /> Pausar
                </button>
              )}
              {paused && (
                <button
                  type="button"
                  className="ig-btn-secondary inline-flex items-center gap-2 px-3 py-2 text-sm"
                  disabled={resuming}
                  onClick={togglePause}
                >
                  {resuming ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                  {resuming ? "Preparando..." : "Continuar"}
                </button>
              )}
              {completedCount > 0 && onSchedulePartial && batch.status !== "ready" && (
                <button type="button" className="ig-btn-secondary px-3 py-2 text-sm" onClick={onSchedulePartial}>
                  Agendar vídeos enviados
                </button>
              )}
              <button type="button" className="rounded-lg border border-ig-border px-3 py-2 text-sm text-ig-muted" onClick={handleCancelBatch}>
                Cancelar lote
              </button>
            </div>
          </div>

          {progress && progress.activeFiles.length > 0 && (
            <div className="rounded-xl border border-ig-border bg-ig-elevated p-4">
              <p className="mb-2 text-sm font-medium text-ig-text">Enviando agora</p>
              <div className="space-y-2">
                {progress.activeFiles.map((file) => (
                  <div key={file.id}>
                    <div className="flex justify-between text-xs">
                      <span className="truncate text-ig-text">{file.filename}</span>
                      <span className="text-ig-muted">{file.percent}%</span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-ig-secondary">
                      <div className="h-full rounded-full bg-ig-primary" style={{ width: `${file.percent}%` }} />
                    </div>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-xs text-ig-muted">{progress.waiting} aguardando · {progress.completed} concluídos</p>
            </div>
          )}

          <div className="rounded-xl border border-ig-border bg-ig-elevated p-4">
            <p className="mb-3 text-sm font-medium text-ig-text">
              Status por vídeo
              {completedOnlyFiles.length > 0 && visibleFiles.length > 0 && (
                <span className="ml-2 text-xs font-normal text-ig-muted">
                  · {completedOnlyFiles.length} enviados
                </span>
              )}
            </p>
            <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
              {listFiles.map((file) => (
                <FileStatusRow
                  key={file.id}
                  file={file}
                  percent={progressMap[file.id] ?? (file.status === "completed" ? 100 : 0)}
                  onRetry={retryFile}
                />
              ))}
            </div>
          </div>
        </>
      )}

      <input ref={fileInputRef} type="file" accept="video/*" multiple className="hidden" onChange={(e) => { handleFileSelection(e.target.files); e.target.value = ""; }} />
      <input
        ref={resumeInputRef}
        type="file"
        accept="video/*"
        multiple
        className="hidden"
        {...({ webkitdirectory: "", directory: "" } as React.InputHTMLAttributes<HTMLInputElement>)}
        onChange={(e) => {
          handleResume(e.target.files);
          e.target.value = "";
        }}
      />

      {(running || resuming) && (
        <div className="flex items-center gap-2 text-sm text-ig-primary">
          <Loader2 size={16} className="animate-spin" />
          {resuming
            ? "Reconhecendo arquivos e retomando upload..."
            : `Enviando em paralelo (${SPEED_PRESETS[speedMode].label})...`}
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
