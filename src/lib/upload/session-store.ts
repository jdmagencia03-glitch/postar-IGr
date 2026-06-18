"use client";

import { UploadEngine, type UploadEngineProgress } from "@/lib/upload/engine";
import {
  buildFileMapFromRecords,
  cancelUploadBatch,
  createUploadBatch,
  ensureBatchWithFiles,
  fetchActiveBatch,
  findRecordForUpload,
  matchFileToRecord,
  refreshUploadBatch,
  resetAllFailedUploadFiles,
  resetFailedUploadFile,
  setBatchPaused,
  setBatchSpeedMode,
} from "@/lib/upload/client";
import { formatUploadErrorMessage, humanizeFetchError } from "@/lib/upload/errors";
import {
  clearManifestBatch,
  getManifestForBatch,
  matchFilesToManifest,
  saveManifestEntries,
} from "@/lib/upload/manifest-store";
import { getSpeedPresets } from "@/lib/upload/storage-config";
import type { UploadSessionConfig, UploadLimits, UploadSessionSnapshot, UploadSessionPhase, ValidationPreview } from "@/lib/upload/session-types";
import { validateFiles } from "@/lib/upload/validate";
import type { UploadBatch, UploadBatchFile, UploadSpeedMode } from "@/lib/types";
import { formatBytes } from "@/lib/upload/validate";

type FileInputHandlers = {
  pickFiles: () => void;
  pickResume: () => void;
  pickRetry: () => void;
};

type BatchListener = (batch: UploadBatch | null) => void;

class UploadSessionStore {
  private listeners = new Set<() => void>();
  private batchListeners = new Set<BatchListener>();
  private fileInputs: FileInputHandlers | null = null;

  engine: UploadEngine | null = null;
  lastFileMap = new Map<string, File>();
  cancelledBatchIds = new Set<string>();
  retryFileId: string | null = null;
  config: UploadSessionConfig | null = null;
  uploadLimits: UploadLimits | null = null;

  batch: UploadBatch | null = null;
  initialLoading = true;
  running = false;
  pausedByUser = false;
  retrying = false;
  resuming = false;
  speedMode: UploadSpeedMode = "normal";
  progress: UploadEngineProgress | null = null;
  progressMap: Record<string, number> = {};
  message: string | null = null;
  validationPreview: ValidationPreview | null = null;

  private snapshot: UploadSessionSnapshot = this.buildSnapshot();

  private progressFrame: number | null = null;
  private pendingProgress: UploadEngineProgress | null = null;
  private initialized = false;
  private autoRetryPass = 0;
  private engineStarting = false;
  private autoRecoveryTimer: ReturnType<typeof setTimeout> | null = null;
  private autoRecoveryScheduled = false;
  private autoRetryResetTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly MAX_AUTO_RETRY_PASSES = 10;
  private static readonly AUTO_RETRY_RESET_MS = 60_000;

  private logUpload(event: string, detail?: Record<string, unknown>) {
    if (typeof console !== "undefined") {
      console.info(`[upload-session] ${event}`, detail ?? "");
    }
  }

  private derivePhase(): UploadSessionPhase {
    if (!this.batch) return "idle";
    if (this.batch.status === "ready") return "completed";
    if (this.pausedByUser) return "paused_by_user";
    if (this.retrying) return "retrying";
    if (this.running) return "uploading";
    if (this.needsFileReselection()) return "needs_attention";
    const hasPending = (this.batch.upload_files ?? []).some(
      (file) => !file.removed && file.status !== "completed",
    );
    if (hasPending) return "needs_attention";
    return "idle";
  }

  private needsFileReselection() {
    if (!this.batch || this.batch.status === "ready") return false;
    const hasPending = (this.batch.upload_files ?? []).some(
      (file) => !file.removed && file.status !== "completed",
    );
    const pendingInSession = (this.batch.upload_files ?? []).filter(
      (file) =>
        !file.removed && file.status !== "completed" && this.lastFileMap.has(file.id),
    );
    return hasPending && pendingInSession.length === 0;
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.snapshot;

  private buildSnapshot(): UploadSessionSnapshot {
    const pendingInSession = (this.batch?.upload_files ?? []).filter(
      (file) =>
        !file.removed && file.status !== "completed" && this.lastFileMap.has(file.id),
    );
    const hasPending = (this.batch?.upload_files ?? []).some(
      (file) => !file.removed && file.status !== "completed",
    );

    return {
      batch: this.batch,
      initialLoading: this.initialLoading,
      running: this.running,
      pausedByUser: this.pausedByUser,
      paused: this.pausedByUser,
      retrying: this.retrying,
      phase: this.derivePhase(),
      resuming: this.resuming,
      speedMode: this.speedMode,
      progress: this.progress,
      progressMap: this.progressMap,
      message: this.message,
      validationPreview: this.validationPreview,
      uploadLimits: this.uploadLimits,
      config: this.config,
      canResumeWithoutPicker: Boolean(
        this.batch && this.batch.status !== "ready" && pendingInSession.length > 0,
      ),
      needsFileReselection: Boolean(
        this.batch && this.batch.status !== "ready" && hasPending && pendingInSession.length === 0,
      ),
    };
  }

  private hasPendingInSession() {
    return (this.batch?.upload_files ?? []).some(
      (file) =>
        !file.removed && file.status !== "completed" && this.lastFileMap.has(file.id),
    );
  }

  private promptReselectFiles() {
    const completedCount = this.progress?.completed ?? this.batch?.completed_files ?? 0;
    const totalCount = this.progress?.total ?? this.batch?.total_files ?? 0;
    this.message = `Selecione novamente os vídeos no computador (ou todos de uma vez). ${completedCount} de ${totalCount} já enviados — esses não serão reenviados.`;
    this.emit();
    this.fileInputs?.pickResume();
  }

  private emit() {
    const wasRunning = this.snapshot.running;
    this.snapshot = this.buildSnapshot();
    for (const listener of this.listeners) listener();
    if (wasRunning && !this.running) {
      this.scheduleAutoRecovery("running_stopped");
    }
  }

  private scheduleAutoRecovery(reason: string) {
    if (
      this.pausedByUser ||
      this.running ||
      this.retrying ||
      this.engineStarting ||
      this.resuming ||
      !this.batch ||
      !this.hasPendingInSession() ||
      this.lastFileMap.size === 0
    ) {
      return;
    }

    if (this.autoRetryPass >= UploadSessionStore.MAX_AUTO_RETRY_PASSES) {
      if (!this.autoRetryResetTimer) {
        this.logUpload("auto_retry_cooldown", { pass: this.autoRetryPass });
        this.message = "Aguardando para tentar novamente automaticamente…";
        this.autoRetryResetTimer = setTimeout(() => {
          this.autoRetryResetTimer = null;
          this.autoRetryPass = 0;
          this.logUpload("auto_retry_cooldown_reset");
          this.scheduleAutoRecovery("cooldown_reset");
        }, UploadSessionStore.AUTO_RETRY_RESET_MS);
      }
      return;
    }

    if (this.autoRecoveryScheduled) return;
    this.autoRecoveryScheduled = true;

    this.autoRecoveryTimer = setTimeout(() => {
      this.autoRecoveryScheduled = false;
      this.autoRecoveryTimer = null;
      if (!this.batch) return;
      void this.autoContinuePendingIfNeeded(this.batch.id, this.lastFileMap, reason);
    }, 400);
  }

  registerFileInputs(handlers: FileInputHandlers | null) {
    this.fileInputs = handlers;
  }

  configureSession(config: UploadSessionConfig) {
    this.config = config;
  }

  registerBatchListener(listener: BatchListener | null) {
    if (!listener) return () => undefined;
    this.batchListeners.add(listener);
    listener(this.batch);
    return () => {
      this.batchListeners.delete(listener);
    };
  }

  private syncBatch(next: UploadBatch | null) {
    this.batch = next;
    for (const listener of this.batchListeners) listener(next);
    this.emit();
  }

  private get speedPresets() {
    return this.uploadLimits?.speed_presets ?? getSpeedPresets(this.uploadLimits?.concurrency);
  }

  private get maxUploadBytes() {
    return (this.uploadLimits?.max_upload_mb ?? 500) * 1024 * 1024;
  }

  private scheduleProgressUpdate = (next: UploadEngineProgress) => {
    this.pendingProgress = next;
    if (this.progressFrame !== null) return;
    this.progressFrame = requestAnimationFrame(() => {
      this.progressFrame = null;
      if (!this.pendingProgress) return;
      this.progress = this.pendingProgress;
      this.emit();
    });
  };

  private setUserMessage(error: unknown, fallback: string) {
    this.message =
      error instanceof Error
        ? formatUploadErrorMessage(humanizeFetchError(error))
        : formatUploadErrorMessage(fallback);
  }

  async initialize() {
    if (this.initialized) return;
    this.initialized = true;

    try {
      const limitsRes = await fetch("/api/upload/limits", { credentials: "include" });
      const limits = (await limitsRes.json()) as UploadLimits;
      if (limitsRes.ok && limits.max_upload_mb) {
        this.uploadLimits = limits;
      } else {
        this.message = "Não foi possível carregar limites de upload. Usando padrão de 500 MB.";
      }
    } catch {
      this.message = "Não foi possível carregar limites de upload. Verifique sua conexão.";
    }

    try {
      const active = await fetchActiveBatch({ summary: true });
      this.batch = active;
      if (active?.upload_speed_mode) this.speedMode = active.upload_speed_mode;
      if (active?.paused) this.pausedByUser = true;
      if (active?.upload_files?.length) {
        const initialProgress: Record<string, number> = {};
        for (const file of active.upload_files) {
          const uploaded = Number(file.bytes_uploaded ?? 0);
          const total = Number(file.file_size);
          if (uploaded > 0 && total > 0 && file.status !== "completed") {
            initialProgress[file.id] = Math.round((uploaded / total) * 100);
          }
        }
        this.progressMap = initialProgress;
      }
    } catch (error) {
      this.setUserMessage(error, "Erro ao carregar lote");
    } finally {
      this.initialLoading = false;
      this.emit();
    }
  }

  setSpeedMode(mode: UploadSpeedMode) {
    this.speedMode = mode;
    if (this.running && this.engine) {
      this.engine.setConcurrency(this.speedPresets[mode].fileConcurrency);
    }
    if (this.batch) {
      void setBatchSpeedMode(this.batch.id, mode)
        .then((updated) => {
          this.batch = updated;
          this.emit();
        })
        .catch(() => undefined);
    }
    this.emit();
  }

  private async tryAutoRetryAfterRun(batchId: string, fileMap: Map<string, File>) {
    if (
      this.pausedByUser ||
      this.cancelledBatchIds.has(batchId) ||
      this.autoRetryPass >= UploadSessionStore.MAX_AUTO_RETRY_PASSES ||
      fileMap.size === 0
    ) {
      if (this.autoRetryPass >= UploadSessionStore.MAX_AUTO_RETRY_PASSES && !this.pausedByUser) {
        this.message = "Aguardando para tentar novamente automaticamente…";
        this.emit();
      }
      this.logUpload("auto_retry_skipped", {
        pausedByUser: this.pausedByUser,
        cancelled: this.cancelledBatchIds.has(batchId),
        pass: this.autoRetryPass,
        fileMapSize: fileMap.size,
      });
      return;
    }

    const refreshed = await refreshUploadBatch(batchId);
    if (refreshed.status === "ready" || refreshed.status === "cancelled") {
      this.autoRetryPass = 0;
      return;
    }

    const failed =
      refreshed.upload_files?.filter((file) => !file.removed && file.status === "failed") ?? [];
    const pendingInMap =
      refreshed.upload_files?.filter(
        (file) =>
          !file.removed &&
          file.status !== "completed" &&
          file.status !== "failed" &&
          fileMap.has(file.id),
      ) ?? [];

    if (!failed.length && !pendingInMap.length) {
      this.autoRetryPass = 0;
      return;
    }

    this.autoRetryPass += 1;
    const batch = failed.length ? await resetAllFailedUploadFiles(refreshed) : refreshed;

    const retryCount = failed.length || pendingInMap.length;
    const reason = failed.length ? "file_error" : "pending_stalled";
    this.logUpload("auto_retry_start", { pass: this.autoRetryPass, retryCount, reason });

    this.retrying = true;
    this.message =
      failed.length > 0
        ? `Erro em um vídeo. Tentando reenviar automaticamente… (tentativa ${this.autoRetryPass})`
        : `Instabilidade detectada. Tentando continuar automaticamente… (tentativa ${this.autoRetryPass})`;
    this.syncBatch(batch);
    await new Promise((resolve) => setTimeout(resolve, 2000 * this.autoRetryPass));

    if (this.pausedByUser || this.cancelledBatchIds.has(batchId)) {
      this.retrying = false;
      this.emit();
      return;
    }

    this.retrying = false;
    await this.startEngine(batch, fileMap);
  }

  private async autoContinuePendingIfNeeded(
    batchId: string,
    fileMap: Map<string, File>,
    reason: string,
  ) {
    if (
      this.pausedByUser ||
      this.running ||
      this.engineStarting ||
      this.retrying ||
      this.cancelledBatchIds.has(batchId) ||
      fileMap.size === 0
    ) {
      return;
    }

    if (this.autoRetryPass >= UploadSessionStore.MAX_AUTO_RETRY_PASSES) {
      this.logUpload("auto_continue_exhausted", { pass: this.autoRetryPass, reason });
      return;
    }

    let refreshed = await refreshUploadBatch(batchId);
    if (refreshed.status === "ready" || refreshed.status === "cancelled") return;

    const failed =
      refreshed.upload_files?.filter((file) => !file.removed && file.status === "failed") ?? [];
    const pendingInMap =
      refreshed.upload_files?.filter(
        (file) =>
          !file.removed &&
          file.status !== "completed" &&
          fileMap.has(file.id),
      ) ?? [];

    if (!pendingInMap.length && !failed.length) return;

    this.logUpload("auto_continue", { reason, pending: pendingInMap.length, failed: failed.length });

    if (failed.length) {
      refreshed = await resetAllFailedUploadFiles(refreshed);
    }
    this.syncBatch(refreshed);
    await this.startEngine(refreshed, fileMap);
  }

  setValidationPreview(preview: ValidationPreview | null) {
    this.validationPreview = preview;
    this.emit();
  }

  private async startEngine(
    currentBatch: UploadBatch,
    fileMap: Map<string, File>,
    onlyFileIds?: string[],
  ) {
    if (this.engineStarting) {
      this.logUpload("start_engine_blocked", { batchId: currentBatch.id, reason: "already_starting" });
      return;
    }
    this.engineStarting = true;
    const batchId = currentBatch.id;

    try {
      const batchWithFiles = await ensureBatchWithFiles(currentBatch);
      if (batchWithFiles !== currentBatch) {
        this.syncBatch(batchWithFiles);
        currentBatch = batchWithFiles;
      }

      this.engine?.stop();
      const engine = new UploadEngine(this.speedPresets[this.speedMode].fileConcurrency, {
        onProgress: this.scheduleProgressUpdate,
        onBatchUpdate: (next) => {
          if (this.cancelledBatchIds.has(next.id)) return;
          this.batch = next;
          for (const listener of this.batchListeners) listener(next);
          this.emit();
        },
        onFileProgress: (fileId, loaded, total) => {
          const percent = Math.round((loaded / total) * 100);
          if (this.progressMap[fileId] !== percent) {
            this.progressMap = { ...this.progressMap, [fileId]: percent };
            this.emit();
          }
        },
        onComplete: async (latest) => {
          if (this.cancelledBatchIds.has(latest.id)) return;
          const refreshed = await refreshUploadBatch(latest.id);
          if (this.cancelledBatchIds.has(latest.id) || refreshed.status === "cancelled") return;
          this.syncBatch(refreshed);
          if (refreshed.status === "ready") {
            this.autoRetryPass = 0;
            this.message = "Upload concluído com sucesso. A IA pode agendar suas publicações.";
          }
          this.emit();
        },
        onError: (errorMessage) => {
          this.logUpload("file_error", { message: errorMessage });
          this.message = formatUploadErrorMessage(errorMessage);
          this.emit();
        },
      });

      this.engine = engine;
      this.lastFileMap = fileMap;
      this.running = true;
      this.pausedByUser = false;
      this.message = null;
      this.logUpload("engine_start", { batchId, files: fileMap.size, onlyFileIds });
      this.emit();

      await engine.run({ batch: currentBatch, fileMap, onlyFileIds });
    } catch (error) {
      this.logUpload("engine_crash", {
        batchId,
        error: error instanceof Error ? error.message : String(error),
      });
      this.setUserMessage(error, "Erro durante upload");
    } finally {
      this.running = false;
      this.engineStarting = false;
      this.emit();
    }

    // Retentativa e continuação automática só após liberar engineStarting (evita deadlock).
    if (!this.pausedByUser && !this.cancelledBatchIds.has(batchId)) {
      await this.tryAutoRetryAfterRun(batchId, fileMap);
      await this.autoContinuePendingIfNeeded(batchId, fileMap, "engine_finished");
    }
  }

  handleFileSelection(selected: FileList | null) {
    if (!selected?.length) return;
    const files = Array.from(selected);
    const validation = validateFiles(files, new Set(), this.maxUploadBytes);
    this.validationPreview = {
      validCount: validation.valid.length,
      invalid: validation.invalid,
      duplicates: validation.duplicates,
      pendingFiles: validation.valid.map((item) => item.file),
    };
    this.emit();
  }

  async handleValidatedUpload(files: File[], skipDuplicates = true) {
    const config = this.config;
    if (!config?.accountId) {
      this.message = "Selecione uma conta antes de enviar.";
      this.emit();
      return;
    }

    const existingHashes = new Set(
      (this.batch?.upload_files ?? []).map((file) => file.file_hash).filter(Boolean) as string[],
    );
    const validation = validateFiles(files, existingHashes, this.maxUploadBytes);
    const toUpload = skipDuplicates
      ? validation.valid
      : [
          ...validation.valid,
          ...validation.duplicates.map((d) => ({ file: d.file, fingerprint: d.fingerprint })),
        ];

    if (!toUpload.length) {
      this.validationPreview = {
        validCount: 0,
        invalid: validation.invalid,
        duplicates: validation.duplicates,
        pendingFiles: [],
      };
      this.emit();
      return;
    }

    this.validationPreview = null;
    this.message = null;
    this.emit();

    try {
      let currentBatch = this.batch;

      if (!currentBatch) {
        currentBatch = await createUploadBatch({
          accountId: config.accountId,
          platform: config.platform,
          scheduleMode: config.scheduleMode,
          customSchedule: config.customSchedule,
          uploadSpeedMode: this.speedMode,
          files: toUpload,
        });
        this.syncBatch(currentBatch);

        await saveManifestEntries(
          toUpload
            .map(({ file, fingerprint }) => {
              const record = findRecordForUpload(
                file,
                fingerprint,
                currentBatch!.upload_files ?? [],
              );
              if (!record) return null;
              return {
                fileId: record.id,
                batchId: currentBatch!.id,
                name: file.name,
                size: file.size,
                lastModified: file.lastModified,
                fingerprint,
              };
            })
            .filter((entry): entry is NonNullable<typeof entry> => entry != null),
        );
      } else if (currentBatch) {
        currentBatch = await ensureBatchWithFiles(currentBatch);
        this.syncBatch(currentBatch);
      }

      const fileMap = new Map<string, File>();
      for (const { file, fingerprint } of toUpload) {
        const record = findRecordForUpload(file, fingerprint, currentBatch.upload_files ?? []);
        if (record) fileMap.set(record.id, file);
      }

      if (!fileMap.size) {
        this.setUserMessage(null, "Nenhum arquivo reconhecido no lote. Tente selecionar novamente.");
        return;
      }

      await this.startEngine(currentBatch, fileMap);
    } catch (error) {
      this.setUserMessage(error, "Erro ao iniciar upload");
      this.running = false;
      this.emit();
    }
  }

  async handleResume(selected: FileList | null) {
    if (!selected?.length || !this.batch) return;

    this.resuming = true;
    this.message = "Reconhecendo arquivos selecionados...";
    this.emit();

    try {
      const files = Array.from(selected).filter(
        (file) => file.type.startsWith("video/") || /\.(mp4|mov|webm)$/i.test(file.name),
      );
      if (!files.length) {
        this.message = "Nenhum vídeo encontrado. Selecione arquivos .mp4, .mov ou .webm.";
        return;
      }

      const manifest = await getManifestForBatch(this.batch.id);
      const fileMap = new Map([
        ...matchFilesToManifest(files, manifest),
        ...buildFileMapFromRecords(files, this.batch.upload_files ?? []),
      ]);

      const pendingRecords = (this.batch.upload_files ?? []).filter(
        (record) => !record.removed && record.status !== "completed",
      );
      const matchedPending = pendingRecords.filter((record) => fileMap.has(record.id)).length;
      const alreadyDone = (this.batch.upload_files ?? []).filter(
        (record) => record.status === "completed",
      ).length;

      if (matchedPending === 0) {
        const sampleNames = pendingRecords
          .slice(0, 3)
          .map((record) => record.filename)
          .join(", ");
        this.message = `Nenhum vídeo pendente reconhecido. Selecione os arquivos certos (ex.: ${sampleNames || "mesmos nomes do lote"}). ${alreadyDone} já enviados e ignorados.`;
        return;
      }

      this.pausedByUser = false;
      await setBatchPaused(this.batch.id, false);
      this.message = `${matchedPending} vídeo(s) reconhecido(s) · ${alreadyDone} já enviados (não serão reenviados).`;

      const onlyFileId = this.retryFileId;
      this.retryFileId = null;

      if (onlyFileId && fileMap.has(onlyFileId)) {
        await this.startEngine(this.batch, fileMap, [onlyFileId]);
        return;
      }

      await this.startEngine(this.batch, fileMap);
    } catch (error) {
      this.message = error instanceof Error ? error.message : "Erro ao retomar upload";
      this.running = false;
    } finally {
      this.resuming = false;
      this.emit();
    }
  }

  async handleRetrySelection(selected: FileList | null) {
    const recordId = this.retryFileId;
    this.retryFileId = null;
    if (!selected?.length || !this.batch || !recordId) return;

    const file = selected[0];
    const record = this.batch.upload_files?.find((item) => item.id === recordId);
    if (!record) return;

    if (!matchFileToRecord(file, [record])) {
      this.message = `Arquivo diferente do esperado. Selecione "${record.filename}" (${formatBytes(Number(record.file_size))}).`;
      this.emit();
      return;
    }

    this.resuming = true;
    this.emit();
    try {
      const reset = await resetFailedUploadFile(this.batch, record.id);
      this.syncBatch(reset);
      const nextMap = { ...this.progressMap };
      delete nextMap[record.id];
      this.progressMap = nextMap;
      this.pausedByUser = false;
      await setBatchPaused(reset.id, false);
      await this.startEngine(reset, new Map([[record.id, file]]), [record.id]);
    } catch (error) {
      this.message = error instanceof Error ? error.message : "Erro ao tentar novamente";
      this.running = false;
    } finally {
      this.resuming = false;
      this.emit();
    }
  }

  resumeInSession() {
    // Sempre reiniciar via startEngine — engine.resume() pula arquivos pausados no meio.
    return false;
  }

  /** Retoma upload pausado usando arquivos já carregados na sessão (sem abrir seletor). */
  async resumePausedUpload() {
    if (!this.batch) return;

    if (!this.lastFileMap.size || !this.hasPendingInSession()) {
      this.promptReselectFiles();
      return;
    }

    if (this.resumeInSession()) return;

    this.pausedByUser = false;
    this.message = null;
    this.resuming = true;
    this.logUpload("resume_paused_by_user");
    this.emit();

    try {
      if (this.running) {
        this.engine?.stop();
        this.running = false;
      }
      await setBatchPaused(this.batch.id, false);
      const refreshed = await refreshUploadBatch(this.batch.id);
      this.batch = refreshed;
      this.autoRetryPass = 0;
      await this.startEngine(refreshed, this.lastFileMap);
    } catch (error) {
      this.message = error instanceof Error ? error.message : "Erro ao retomar upload";
      this.running = false;
      this.emit();
    } finally {
      this.resuming = false;
      this.emit();
    }
  }

  /** Sincroniza progresso ao voltar para a aba (upload segue em segundo plano). */
  async reconcileOnForeground() {
    if (typeof document !== "undefined" && document.hidden) return;

    if (!this.batch) return;

    try {
      const refreshed = await refreshUploadBatch(this.batch.id);

      if (this.running || this.retrying) {
        this.batch = refreshed;
        const nextProgress: Record<string, number> = { ...this.progressMap };
        for (const file of refreshed.upload_files ?? []) {
          const uploaded = Number(file.bytes_uploaded ?? 0);
          const total = Number(file.file_size);
          if (file.status === "completed") {
            nextProgress[file.id] = 100;
          } else if (uploaded > 0 && total > 0) {
            nextProgress[file.id] = Math.round((uploaded / total) * 100);
          }
        }
        this.progressMap = nextProgress;
        this.emit();
        return;
      }

      this.batch = refreshed;
      if (refreshed.paused) {
        this.pausedByUser = true;
        this.logUpload("foreground_sync_paused_by_user");
      }

      const incomplete = (refreshed.upload_files ?? []).some(
        (file) => !file.removed && file.status !== "completed",
      );

      if (
        incomplete &&
        !this.pausedByUser &&
        this.lastFileMap.size > 0 &&
        this.hasPendingInSession()
      ) {
        this.logUpload("foreground_auto_continue");
        await this.autoContinuePendingIfNeeded(this.batch.id, this.lastFileMap, "foreground");
        return;
      }

      if (
        incomplete &&
        this.needsFileReselection() &&
        !this.message?.includes("Selecione novamente")
      ) {
        this.message =
          "Selecione novamente os vídeos no computador para continuar o envio.";
      }
      this.emit();
    } catch (error) {
      this.logUpload("foreground_reconcile_error", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async continueUpload() {
    if (this.pausedByUser) {
      await this.resumePausedUpload();
      return;
    }

    if (this.batch && this.lastFileMap.size > 0 && this.hasPendingInSession()) {
      this.scheduleAutoRecovery("continue_upload");
      return;
    }

    this.promptReselectFiles();
  }

  openChooseVideos() {
    void this.continueUpload();
  }

  openFilePicker() {
    this.fileInputs?.pickFiles();
  }

  async togglePause() {
    if (!this.batch) return;

    if (this.running && !this.pausedByUser) {
      this.logUpload("paused_by_user");
      this.engine?.pause();
      this.pausedByUser = true;
      this.running = false;
      await setBatchPaused(this.batch.id, true);
      this.message = "Upload pausado. Clique em Retomar para continuar de onde parou.";
      this.emit();
      return;
    }

    this.pausedByUser = false;
    await setBatchPaused(this.batch.id, false);
    await this.resumePausedUpload();
  }

  async cancelBatch() {
    if (!this.batch) return;
    if (!window.confirm("Cancelar este lote? Os vídeos já enviados serão descartados deste lote.")) {
      return;
    }

    this.cancelledBatchIds.add(this.batch.id);
    this.engine?.stop();
    try {
      await cancelUploadBatch(this.batch.id);
      await clearManifestBatch(this.batch.id);
      this.batch = null;
      this.progress = null;
      this.progressMap = {};
      this.running = false;
      this.pausedByUser = false;
      this.retrying = false;
      this.message = "Lote cancelado.";
      for (const listener of this.batchListeners) listener(null);
    } catch (error) {
      this.message = error instanceof Error ? error.message : "Erro ao cancelar lote";
    }
    this.emit();
  }

  retryFile(record: UploadBatchFile) {
    if (!this.batch) return;
    this.retryFileId = record.id;
    this.message = `Selecione o arquivo "${record.filename}" no seu computador.`;
    this.emit();
    this.fileInputs?.pickRetry();
  }
}

export const uploadSessionStore = new UploadSessionStore();
