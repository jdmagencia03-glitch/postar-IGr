import type { UploadBatch, UploadBatchFile } from "@/lib/types";
import { uploadBatchFile } from "@/lib/upload/client";

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
  onComplete?: (batch: UploadBatch) => void;
  onError?: (message: string) => void;
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

  private sumLiveBytes(batch: UploadBatch) {
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
    const uploading = files.filter((file) => file.status === "uploading").length;
    const waiting = files.filter(
      (file) => file.status === "pending" || file.status === "failed",
    ).length;
    const total = files.length;

    const activeFiles = [...fileProgress.entries()]
      .filter(([, value]) => value.percent > 0 && value.percent < 100)
      .slice(0, 4)
      .map(([id, value]) => ({ id, filename: value.filename, percent: value.percent }));

    const speedBps = this.getSpeedBps();
    const remaining = Math.max(0, this.bytesTotal - this.bytesUploaded);
    const etaSeconds = speedBps > 0 ? remaining / speedBps : 0;

    this.callbacks.onProgress?.({
      completed,
      failed,
      uploading,
      waiting,
      total,
      overallPercent: this.bytesTotal ? Math.round((this.bytesUploaded / this.bytesTotal) * 100) : 0,
      bytesUploaded: this.bytesUploaded,
      bytesTotal: this.bytesTotal,
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
      .filter((record) => record.status !== "completed")
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
    let finishedCount = 0;
    this.workerPromises = [];

    const uploadOne = async (record: UploadBatchFile): Promise<UploadOutcome> => {
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

        batch = await this.withBatchLock(() =>
          uploadBatchFile({
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
              this.updateSpeed(this.sumLiveBytes(batch));
              this.callbacks.onFileProgress?.(currentRecord.id, loaded, total);
              this.emitProgress(batch, fileProgress);
            },
          }),
        );

        const updatedRecord = batch.upload_files?.find((item) => item.id === currentRecord.id);

        if (!updatedRecord || updatedRecord.status === "failed") {
          this.callbacks.onBatchUpdate?.(batch);
          this.emitProgress(batch, fileProgress);
          this.callbacks.onError?.(
            updatedRecord?.error_message ?? `Falha ao enviar ${currentRecord.filename}`,
          );
          return "done";
        }

        if (updatedRecord.status !== "completed") {
          return "done";
        }

        fileProgress.set(currentRecord.id, { percent: 100, filename: currentRecord.filename });
        this.liveLoadedBytes.set(currentRecord.id, Number(currentRecord.file_size));
        finishedCount += 1;
        if (finishedCount % 5 === 0 || finishedCount === records.length) {
          this.callbacks.onBatchUpdate?.(batch);
        }
        this.emitProgress(batch, fileProgress);
        return "done";
      } catch (error) {
        if (controller.signal.aborted && this.paused && !this.stopped) {
          return "requeue";
        }
        if (!controller.signal.aborted) {
          this.callbacks.onError?.(
            error instanceof Error ? error.message : `Falha ao enviar ${currentRecord.filename}`,
          );
        }
        return "done";
      } finally {
        this.abortControllers.delete(currentRecord.id);
      }
    };

    const worker = async () => {
      while (!this.stopped) {
        if (this.paused) {
          await this.waitWhilePaused();
          continue;
        }

        const record = pendingQueue.shift();
        if (!record) return;

        const outcome = await uploadOne(record);
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

    const activeFiles = (batch.upload_files ?? []).filter(
      (file) =>
        !file.removed &&
        (file.status === "pending" || file.status === "uploading") &&
        fileMap.has(file.id),
    );
    if (!this.stopped && activeFiles.length === 0) {
      this.callbacks.onComplete?.(batch);
    }

    return batch;
  }
}
