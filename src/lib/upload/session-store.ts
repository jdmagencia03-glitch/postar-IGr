"use client";

import { UploadEngine, type UploadEngineProgress } from "@/lib/upload/engine";
import {
  buildFileMapFromRecords,
  cancelUploadBatch,
  createUploadBatch,
  fetchActiveBatch,
  matchFileToRecord,
  refreshUploadBatch,
  resetFailedUploadFile,
  setBatchPaused,
} from "@/lib/upload/client";
import {
  clearManifestBatch,
  getManifestForBatch,
  matchFilesToManifest,
  saveManifestEntries,
} from "@/lib/upload/manifest-store";
import { getSpeedPresets } from "@/lib/upload/storage-config";
import type { UploadSessionConfig, UploadLimits, UploadSessionSnapshot, ValidationPreview } from "@/lib/upload/session-types";
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
  paused = false;
  resuming = false;
  speedMode: UploadSpeedMode = "turbo";
  progress: UploadEngineProgress | null = null;
  progressMap: Record<string, number> = {};
  message: string | null = null;
  validationPreview: ValidationPreview | null = null;

  private snapshot: UploadSessionSnapshot = this.buildSnapshot();

  private progressFrame: number | null = null;
  private pendingProgress: UploadEngineProgress | null = null;
  private initialized = false;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.snapshot;

  private buildSnapshot(): UploadSessionSnapshot {
    const hasPending = (this.batch?.upload_files ?? []).some(
      (file) => !file.removed && file.status !== "completed",
    );

    return {
      batch: this.batch,
      initialLoading: this.initialLoading,
      running: this.running,
      paused: this.paused,
      resuming: this.resuming,
      speedMode: this.speedMode,
      progress: this.progress,
      progressMap: this.progressMap,
      message: this.message,
      validationPreview: this.validationPreview,
      uploadLimits: this.uploadLimits,
      config: this.config,
      canResumeWithoutPicker: Boolean(
        this.lastFileMap.size > 0 &&
          this.batch &&
          this.batch.status !== "ready" &&
          hasPending &&
          (!this.running || this.engine?.isPaused()),
      ),
    };
  }

  private emit() {
    this.snapshot = this.buildSnapshot();
    for (const listener of this.listeners) listener();
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
    return getSpeedPresets(this.uploadLimits?.concurrency);
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

  async initialize() {
    if (this.initialized) return;
    this.initialized = true;

    try {
      const limitsRes = await fetch("/api/upload/limits", { credentials: "include" });
      const limits = (await limitsRes.json()) as UploadLimits;
      if (limitsRes.ok && limits.max_upload_mb) this.uploadLimits = limits;
    } catch {
      // ignore
    }

    try {
      const active = await fetchActiveBatch();
      this.batch = active;
      if (active?.upload_speed_mode) this.speedMode = active.upload_speed_mode;
      if (active?.paused) this.paused = true;
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
      this.message = error instanceof Error ? error.message : "Erro ao carregar lote";
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
    this.emit();
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
        this.running = false;
        this.paused = false;
        if (refreshed.status === "ready") {
          this.message = "Upload concluído com sucesso. A IA pode agendar suas publicações.";
        }
        this.emit();
      },
      onError: (errorMessage) => {
        this.message = errorMessage;
        this.emit();
      },
    });

    this.engine = engine;
    this.lastFileMap = fileMap;
    this.running = true;
    this.paused = false;
    this.emit();

    try {
      await engine.run({ batch: currentBatch, fileMap, onlyFileIds });
    } finally {
      this.running = false;
      this.emit();
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

      await this.startEngine(currentBatch, fileMap);
    } catch (error) {
      this.message = error instanceof Error ? error.message : "Erro ao iniciar upload";
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

      this.paused = false;
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
      this.paused = false;
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
    if (!this.batch || !this.engine?.isPaused() || this.lastFileMap.size === 0) return false;
    this.paused = false;
    void setBatchPaused(this.batch.id, false);
    this.engine.resume();
    this.running = true;
    this.message = null;
    this.emit();
    return true;
  }

  /** Sincroniza progresso ao voltar para a aba (upload segue em segundo plano). */
  async reconcileOnForeground() {
    if (typeof document !== "undefined" && document.hidden) return;

    if (!this.batch) return;

    try {
      const refreshed = await refreshUploadBatch(this.batch.id);

      if (this.running) {
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
      if (refreshed.paused) this.paused = true;

      const incomplete = (refreshed.upload_files ?? []).some(
        (file) => !file.removed && file.status !== "completed",
      );

      if (
        incomplete &&
        this.lastFileMap.size > 0 &&
        !this.message?.includes("Continuar upload")
      ) {
        this.message =
          "Upload interrompido. Clique em Continuar upload para retomar de onde parou.";
      }
      this.emit();
    } catch {
      // ignore
    }
  }

  async continueUpload() {
    if (this.resumeInSession()) return;

    if (this.batch && this.lastFileMap.size > 0 && !this.running) {
      const hasPending = (this.batch.upload_files ?? []).some(
        (file) => !file.removed && file.status !== "completed",
      );
      if (hasPending) {
        this.message = null;
        this.paused = false;
        this.resuming = true;
        this.emit();
        try {
          await setBatchPaused(this.batch.id, false);
          const refreshed = await refreshUploadBatch(this.batch.id);
          this.batch = refreshed;
          await this.startEngine(refreshed, this.lastFileMap);
        } catch (error) {
          this.message = error instanceof Error ? error.message : "Erro ao retomar upload";
          this.running = false;
          this.emit();
        } finally {
          this.resuming = false;
          this.emit();
        }
        return;
      }
    }

    const completedCount = this.progress?.completed ?? this.batch?.completed_files ?? 0;
    const totalCount = this.progress?.total ?? this.batch?.total_files ?? 0;
    this.message = `Selecione no seu computador os vídeos que faltam (ou todos de uma vez). ${completedCount} de ${totalCount} já enviados — esses não serão reenviados.`;
    this.emit();
    this.fileInputs?.pickResume();
  }

  openChooseVideos() {
    void this.continueUpload();
  }

  openFilePicker() {
    this.fileInputs?.pickFiles();
  }

  async togglePause() {
    if (!this.batch) return;

    if (this.running && !this.paused) {
      this.engine?.pause();
      this.paused = true;
      this.running = false;
      await setBatchPaused(this.batch.id, true);
      this.message = "Upload pausado. Seu progresso foi salvo.";
      this.emit();
      return;
    }

    this.paused = false;
    await setBatchPaused(this.batch.id, false);
    if (this.resumeInSession()) return;
    void this.continueUpload();
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
      this.paused = false;
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
