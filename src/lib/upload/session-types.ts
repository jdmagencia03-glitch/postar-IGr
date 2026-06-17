import type { UploadEngineProgress } from "@/lib/upload/engine";
import type { DuplicateFile, InvalidFile } from "@/lib/upload/validate";
import type { UploadSpeedPresets } from "@/lib/upload/storage-config";
import type { UploadBatch, UploadSpeedMode } from "@/lib/types";

export type UploadLimits = {
  max_upload_mb: number;
  bucket_limit_mb: number | null;
  bucket_limit_label: string | null;
  browser_concurrency_cap?: number;
  concurrency: { economy: number; normal: number; turbo: number };
  concurrency_configured?: { economy: number; normal: number; turbo: number };
  speed_presets?: UploadSpeedPresets;
};

export type ValidationPreview = {
  validCount: number;
  invalid: InvalidFile[];
  duplicates: DuplicateFile[];
  pendingFiles: File[];
};

export type UploadSessionConfig = {
  accountId: string;
  platform?: UploadBatch["platform"];
  scheduleMode: UploadBatch["schedule_mode"];
  customSchedule?: UploadBatch["custom_schedule"];
};

export type UploadSessionSnapshot = {
  batch: UploadBatch | null;
  initialLoading: boolean;
  running: boolean;
  paused: boolean;
  resuming: boolean;
  speedMode: UploadSpeedMode;
  progress: UploadEngineProgress | null;
  progressMap: Record<string, number>;
  message: string | null;
  validationPreview: ValidationPreview | null;
  uploadLimits: UploadLimits | null;
  config: UploadSessionConfig | null;
  /** Arquivos ainda estão na memória — dá para retomar sem reescolher no disco. */
  canResumeWithoutPicker: boolean;
  /** Faltam vídeos na sessão — precisa abrir seletor de arquivos. */
  needsFileReselection: boolean;
};
