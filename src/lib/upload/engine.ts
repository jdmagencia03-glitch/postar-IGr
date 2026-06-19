import type { UploadBatch, UploadBatchFile } from "@/lib/types";
import { applyBatchFilePatch, uploadBatchFile } from "@/lib/upload/client";

type UploadOutcome = "done" | "requeue" | "stopped";

export interface UploadEngineProgress {
  completed: number;
  failed: number;
  uploading: number;
  waiting: number;
  total: number;
  overallPercent: number;
  bytesUploaded: number;
  bytesTotal: number;
  speedBps: number;
  etaSeconds: number;
  activeFiles: Array<{ id: string; filename: string; percent: number }>;
}

export interface UploadEngineCallbacks {
  onProgress?: (progress: UploadEngineProgress) => void;
  onBatchUpdate?: (batch: UploadBatch) => void;
  onFileProgress?: (fileId: string, loaded: number, total: number) => void;
  onFileRetryScheduled?: (
    fileId: string,
    detail: {
      attempt: number;
      maxAttempts: number;
      delayMs: number;
      errorMessage: string;
      errorKind: string;
    },
  ) => void;
  onFileRecovered?: (fileId: string) => void;
  onComplete?: (batch: UploadBatch) => void;
  onError?: (message: string, fileId?: string) => void;
  onEngineIdle?: (batch: UploadBatch) => void;
}

export class UploadEngine {
  private paused = false;
  private stopped = false;
  private abortControllers = new Map<string, AbortController>();
  private speedSamples: number[] = [];
  private lastSpeedAt = Date.now();
  private lastBytes = 0;
  private bytesUploaded = 0;
  private bytesTotal = 0;
  private liveLoadedBytes = new Map<string, number>();
  private targetConcurrency = 1;
  private workerPromises: Promise<void>[] = [];
  private spawnWorker: (() => void) | null = null;
  private batchMutex = Promise.resolve();

  constructor(
    private fileConcurrency: number,
    private callbacks: UploadEngineCallbacks = {},
  ) {}

  setConcurrency(concurrency: number) {
    const next = Math.max(1, concurrency);
    const previous = this.targetConcurrency;
    this.targetConcurrency = next;
    this.fileConcurrency = next;

    if (next > previous && this.spawnWorker && !this.stopped) {
      for (let i = previous; i < next; i++) {
        this.spawnWorker();
      }
    }
  }

  getConcurrency() {
    return this.targetConcurrency;
  }

  abortFile(fileId: string) {
    this.abortControllers.get(fileId)?.abort();
  }

  abortAll() {
    for (const controller of this.abortControllers.values()) {
      controller.abort();
    }
  }

  pause() {
    console.info("[upload-engine] pause");
    this.paused = true;
    for (const controller of this.abortControllers.values()) {
      controller.abort();
    }
  }

  resume() {
    console.info("[upload-engine] resume");
    this.paused = false;
  }

  stop() {
    console.info("[upload-engine] stop");
    this.stopped = true;
    this.pause();
  }

  isPaused() {
    return this.paused;
  }

  private waitWhilePaused() {
    return new Promise<void>((resolve) => {
      const tick = () => {
        if (this.stopped || !this.paused) {
          resolve();
          return;
        }
        setTimeout(tick, 200);
      };
      tick();
    });
  }

  private withBatchLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.batchMutex.then(fn);
    this.batchMutex = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private updateSpeed(bytes: number) {
    if (bytes < this.lastBytes) {
      this.lastBytes = bytes;
      this.lastSpeedAt = Date.now();
    }

    this.bytesUploaded = bytes;
    const now = Date.now();
    const elapsed = (now - this.lastSpeedAt) / 1000;
    if (elapsed >= 1) {
      const delta = bytes - this.lastBytes;
      if (delta > 0) {
        const bps = delta / elapsed;
        this.speedSamples.push(bps);
        if (this.speedSamples.length > 5) this.speedSamples.shift();
      }
      this.lastBytes = bytes;
      this.lastSpeedAt = now;
    }
  }

  private getSpeedBps() {
    const positive = this.speedSamples.filter((value) => value > 0);
    if (!positive.length) return 0;
    return positive.reduce((sum, value) => sum + value, 0) / positive.length;
  }

  private batchBytesTotal(batch: UploadBatch) {
    return (batch.upload_files ?? [])
      .filter((file) => !file.removed)
      .reduce((sum, file) => sum + Number(file.file_size), 0);
  }

  private sumPersistedAndLiveBytes(batch: UploadBatch) {
    let total = 0;
    for (const record of batch.upload_files ?? []) {
      if (record.removed) continue;
      if (record.status === "completed") {
        total += Number(record.file_size);
        continue;
      }
      const live = this.liveLoadedBytes.get(record.id);
      if (live != null) {
        total += live;
        continue;
      }
      total += Number(record.bytes_uploaded ?? 0);
    }
    return total;
  }

  private emitProgress(
    batch: UploadBatch,
    fileProgress: Map<string, { percent: number; filename: string }>,
  ) {
    const files = (batch.upload_files ?? []).filter((file) => !file.removed);
    const completed = files.filter((file) => file.status === "completed").length;
    const failed = files.filter((file) => file.status === "failed").length;
    const uploading = files.filter(
      (file) => file.status === "uploading" || file.status === "retrying",
    ).length;
    const waiting = files.filter((file) => file.status === "pending").length;
    const total = files.length;

    const activeFiles = [...fileProgress.entries()]
      .filter(([, value]) => value.percent > 0 && value.percent < 100)
      .slice(0, 4)
      .map(([id, value]) => ({ id, filename: value.filename, percent: value.percent }));

    const speedBps = this.getSpeedBps();
    const batchTotal = this.batchBytesTotal(batch);
    const loadedBytes = this.sumPersistedAndLiveBytes(batch);
    const remaining = Math.max(0, batchTotal - loadedBytes);
    const etaSeconds = speedBps > 0 ? remaining / speedBps : 0;

    this.callbacks.onProgress?.({
      completed,
      failed,
      uploading,
      waiting,
      total: files.length,
      overallPercent: batchTotal ? Math.min(100, Math.round((loadedBytes / batchTotal) * 100)) : 0,
      bytesUploaded: loadedBytes,
      bytesTotal: batchTotal,
      speedBps,
      etaSeconds,
      activeFiles,
    });
  }

  async run(params: {
    batch: UploadBatch;
    fileMap: Map<string, File>;
    onlyFileIds?: string[];
  }) {
    const { fileMap, onlyFileIds } = params;
    let batch = params.batch;
    const records = [...(batch.upload_files ?? [])]
      .filter((record) => !record.removed)
      .filter((record) => !onlyFileIds || onlyFileIds.includes(record.id))
      .filter((record) => record.status !== "completed" && record.status !== "failed")
      .filter((record) => fileMap.has(record.id))
      .sort((a, b) => a.sort_order - b.sort_order);

    this.bytesTotal = records.reduce((sum, record) => sum + Number(record.file_size), 0);

    this.speedSamples = [];
    this.liveLoadedBytes.clear();
    this.bytesUploaded = 0;
    this.lastBytes = 0;
    this.lastSpeedAt = Date.now();

    batch.upload_files?.forEach((record) => {
      if (record.removed) return;
      if (record.status === "completed") {
        this.bytesUploaded += Number(record.file_size);
      } else if (Number(record.bytes_uploaded ?? 0) > 0) {
        this.bytesUploaded += Number(record.bytes_uploaded);
      }
    });

    const fileProgress = new Map<string, { percent: number; filename: string }>();
    this.targetConcurrency = Math.max(1, this.fileConcurrency);
    const pendingQueue = [...records];
    const requeueCounts = new Map<string, number>();
    this.workerPromises = [];
    let workerSeq = 0;

    const uploadOne = async (record: UploadBatchFile, workerId: number): Promise<UploadOutcome> => {
      const file = fileMap.get(record.id);
      if (!file) return "done";

      if (this.stopped) return "stopped";

      fileProgress.set(record.id, { percent: 0, filename: record.filename });
      let currentRecord = record;

      const controller = new AbortController();
      this.abortControllers.set(currentRecord.id, controller);

      try {
        await this.waitWhilePaused();
        if (this.stopped) return "stopped";

        console.info("[upload-worker-start]", {
          batchId: batch.id,
          fileId: currentRecord.id,
          fileName: currentRecord.filename,
          workerId,
          status: currentRecord.status,
        });

        const patch = await uploadBatchFile({
          batch,
          record: currentRecord,
          file,
          signal: controller.signal,
          onProgress: (loaded, total) => {
            fileProgress.set(currentRecord.id, {
              percent: Math.round((loaded / total) * 100),
              filename: currentRecord.filename,
            });

            this.liveLoadedBytes.set(currentRecord.id, loaded);
            this.updateSpeed(this.sumPersistedAndLiveBytes(batch));
            this.callbacks.onFileProgress?.(currentRecord.id, loaded, total);
            this.emitProgress(batch, fileProgress);
          },
          onRetryScheduled: (detail) => {
            batch = applyBatchFilePatch(batch, {
              file: { ...currentRecord, status: "retrying" },
              counters: null,
            });
            currentRecord = batch.upload_files?.find((item) => item.id === currentRecord.id) ?? {
              ...currentRecord,
              status: "retrying",
            };
            this.callbacks.onBatchUpdate?.(batch);
            this.callbacks.onFileRetryScheduled?.(currentRecord.id, detail);
            this.emitProgress(batch, fileProgress);
          },
          onRecovered: () => {
            batch = applyBatchFilePatch(batch, {
              file: { ...currentRecord, status: "uploading" },
              counters: null,
            });
            currentRecord = batch.upload_files?.find((item) => item.id === currentRecord.id) ?? {
              ...currentRecord,
              status: "uploading",
            };
            this.callbacks.onBatchUpdate?.(batch);
            this.callbacks.onFileRecovered?.(currentRecord.id);
            this.emitProgress(batch, fileProgress);
          },
        });

        batch = await this.withBatchLock(() =>
          Promise.resolve(applyBatchFilePatch(batch, patch)),
        );

        const updatedRecord = batch.upload_files?.find((item) => item.id === currentRecord.id);

        if (!updatedRecord || updatedRecord.status === "failed") {
          console.info("[upload-worker-failed]", {
            batchId: batch.id,
            fileId: currentRecord.id,
            workerId,
          });
          this.callbacks.onBatchUpdate?.(batch);
          this.emitProgress(batch, fileProgress);
          this.callbacks.onError?.(
            updatedRecord?.error_message ?? `Falha ao enviar ${currentRecord.filename}`,
            currentRecord.id,
          );
          return "done";
        }

        if (updatedRecord.status !== "completed") {
          const requeues = requeueCounts.get(currentRecord.id) ?? 0;
          if (requeues < 1 && !this.stopped) {
            requeueCounts.set(currentRecord.id, requeues + 1);
            console.info("[upload-worker-requeue]", {
              batchId: batch.id,
              fileId: currentRecord.id,
              status: updatedRecord.status,
              workerId,
            });
            return "requeue";
          }
          console.info("[upload-worker-abort]", {
            batchId: batch.id,
            fileId: currentRecord.id,
            status: updatedRecord.status,
            workerId,
          });
          return "done";
        }

        console.info("[upload-worker-completed]", {
          batchId: batch.id,
          fileId: currentRecord.id,
          workerId,
        });
        fileProgress.set(currentRecord.id, { percent: 100, filename: currentRecord.filename });
        this.liveLoadedBytes.set(currentRecord.id, Number(currentRecord.file_size));
        this.callbacks.onBatchUpdate?.(batch);
        this.emitProgress(batch, fileProgress);
        return "done";
      } catch (error) {
        if (controller.signal.aborted && this.paused && !this.stopped) {
          return "requeue";
        }
        if (!controller.signal.aborted) {
          console.info("[upload-worker-stalled]", {
            batchId: batch.id,
            fileId: currentRecord.id,
            workerId,
            error: error instanceof Error ? error.message : String(error),
          });
          this.callbacks.onError?.(
            error instanceof Error ? error.message : `Falha ao enviar ${currentRecord.filename}`,
            currentRecord.id,
          );
          const requeues = requeueCounts.get(currentRecord.id) ?? 0;
          if (requeues < 1 && !this.stopped) {
            requeueCounts.set(currentRecord.id, requeues + 1);
            return "requeue";
          }
        }
        return "done";
      } finally {
        this.abortControllers.delete(currentRecord.id);
      }
    };

    const worker = async () => {
      const workerId = ++workerSeq;
      while (!this.stopped) {
        if (this.paused) {
          await this.waitWhilePaused();
          continue;
        }

        const record = pendingQueue.shift();
        if (!record) return;

        console.info("[upload-queue-next]", {
          batchId: batch.id,
          fileId: record.id,
          fileName: record.filename,
          workerId,
          queueRemaining: pendingQueue.length,
        });

        const outcome = await uploadOne(record, workerId);
        if (outcome === "requeue" && !this.stopped) {
          pendingQueue.unshift(record);
        }
        if (outcome === "stopped") return;
      }
    };

    const spawnWorker = () => {
      const workerPromise = worker();
      this.workerPromises.push(workerPromise);
    };

    this.spawnWorker = spawnWorker;

    for (let i = 0; i < this.targetConcurrency; i++) {
      spawnWorker();
    }

    await Promise.all(this.workerPromises);
    this.spawnWorker = null;
    this.callbacks.onBatchUpdate?.(batch);
    this.callbacks.onEngineIdle?.(batch);

    const activeFiles = (batch.upload_files ?? []).filter(
      (file) =>
        !file.removed &&
        (file.status === "pending" || file.status === "uploading" || file.status === "retrying") &&
        fileMap.has(file.id),
    );
    if (!this.stopped && activeFiles.length === 0) {
      this.callbacks.onComplete?.(batch);
    }

    return batch;
  }
}
