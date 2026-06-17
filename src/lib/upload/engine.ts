import type { UploadBatch, UploadBatchFile, UploadSpeedMode } from "@/lib/types";
import { getSpeedPresets } from "@/lib/upload/storage-config";
import { uploadBatchFile } from "@/lib/upload/client";

export const SPEED_PRESETS = getSpeedPresets();

const RETRY_DELAYS = [3000, 10000, 30000];

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

  constructor(
    private speedMode: UploadSpeedMode = "normal",
    private callbacks: UploadEngineCallbacks = {},
  ) {}

  pause() {
    this.paused = true;
    for (const controller of this.abortControllers.values()) {
      controller.abort();
    }
  }

  resume() {
    this.paused = false;
  }

  stop() {
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

  private updateSpeed(bytes: number) {
    this.bytesUploaded = bytes;
    const now = Date.now();
    const elapsed = (now - this.lastSpeedAt) / 1000;
    if (elapsed >= 1) {
      const delta = bytes - this.lastBytes;
      const bps = delta / elapsed;
      this.speedSamples.push(bps);
      if (this.speedSamples.length > 5) this.speedSamples.shift();
      this.lastBytes = bytes;
      this.lastSpeedAt = now;
    }
  }

  private getSpeedBps() {
    if (!this.speedSamples.length) return 0;
    return this.speedSamples.reduce((sum, value) => sum + value, 0) / this.speedSamples.length;
  }

  private emitProgress(
    batch: UploadBatch,
    fileMap: Map<string, { percent: number; filename: string }>,
  ) {
    const files = batch.upload_files ?? [];
    const completed = files.filter((file) => file.status === "completed").length;
    const failed = files.filter((file) => file.status === "failed").length;
    const uploading = files.filter((file) => file.status === "uploading").length;
    const waiting = files.filter(
      (file) => file.status === "pending" || file.status === "failed",
    ).length;
    const total = files.length;

    const activeFiles = [...fileMap.entries()]
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
      .sort((a, b) => a.sort_order - b.sort_order);

    this.bytesTotal = records.reduce((sum, record) => {
      if (record.status === "completed") return sum;
      return sum + Number(record.file_size);
    }, 0);

    batch.upload_files?.forEach((record) => {
      if (record.status === "completed") {
        this.bytesUploaded += Number(record.file_size);
      } else if (Number(record.bytes_uploaded ?? 0) > 0) {
        this.bytesUploaded += Number(record.bytes_uploaded);
      }
    });

    const fileProgress = new Map<string, { percent: number; filename: string }>();
    const concurrency = SPEED_PRESETS[this.speedMode].fileConcurrency;
    let index = 0;

    const uploadOne = async (record: UploadBatchFile) => {
      const file = fileMap.get(record.id);
      if (!file) return;

      fileProgress.set(record.id, { percent: 0, filename: record.filename });

      for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
        if (this.stopped) return;
        await this.waitWhilePaused();
        if (this.stopped) return;

        if (attempt > 0) {
          await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS[attempt - 1]));
        }

        const controller = new AbortController();
        this.abortControllers.set(record.id, controller);

        try {
          batch = await uploadBatchFile({
            batch,
            record,
            file,
            signal: controller.signal,
            onProgress: (loaded, total) => {
              fileProgress.set(record.id, {
                percent: Math.round((loaded / total) * 100),
                filename: record.filename,
              });

              const completedBytes = (batch.upload_files ?? []).reduce((sum, item) => {
                if (item.id === record.id) return sum + loaded;
                if (item.status === "completed") return sum + Number(item.file_size);
                return sum + Number(item.bytes_uploaded ?? 0);
              }, 0);

              this.updateSpeed(completedBytes);
              this.callbacks.onFileProgress?.(record.id, loaded, total);
              this.emitProgress(batch, fileProgress);
            },
          });

          fileProgress.set(record.id, { percent: 100, filename: record.filename });
          this.callbacks.onBatchUpdate?.(batch);
          this.emitProgress(batch, fileProgress);
          return;
        } catch (error) {
          if (controller.signal.aborted && this.paused) return;
          if (attempt === RETRY_DELAYS.length) {
            this.callbacks.onError?.(
              error instanceof Error ? error.message : `Falha ao enviar ${record.filename}`,
            );
          }
        } finally {
          this.abortControllers.delete(record.id);
        }
      }
    };

    const worker = async () => {
      while (!this.stopped) {
        if (this.paused) {
          await this.waitWhilePaused();
          continue;
        }

        const current = index++;
        if (current >= records.length) return;
        await uploadOne(records[current]);
      }
    };

    await Promise.all(Array.from({ length: concurrency }, () => worker()));
    this.callbacks.onComplete?.(batch);
    return batch;
  }
}
