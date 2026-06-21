import type { UploadEngineProgress } from "@/lib/upload/engine";
import type { DuplicateFile, InvalidFile } from "@/lib/upload/validate";
import type { UploadSpeedPresets } from "@/lib/upload/storage-config";
import type { UploadBatch, UploadSpeedMode } from "@/lib/types";
import type { AdaptiveEffectiveMode, AdaptiveStabilityStatus } from "@/lib/upload/adaptive";

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

/** Fase visível do upload na sessão (não confundir com status por arquivo). */
export type UploadSessionPhase =
  | "idle"
  | "uploading"
  | "retrying"
  | "paused_by_user"
  | "needs_attention"
  | "completed";

/** Estado efêmero por arquivo (retry, countdown) — não persiste no backend. */
export type UploadFileRuntimeState = {
  status?:
    | "retrying"
    | "uploading"
    | "recovered"
    | "stalled"
    | "waiting_claim"
    | "reserved_by_worker"
    | "reconciling"
    | "reconcile_network_error"
    | "completed_local_pending_server_confirm";
  attempt?: number;
  maxAttempts?: number;
  nextRetryAt?: number;
  retryInMs?: number;
  message?: string;
  claimAttempts?: number;
};

export type UploadSessionSnapshot = {
  batch: UploadBatch | null;
  initialLoading: boolean;
  running: boolean;
  /** Pausa iniciada manualmente pelo usuário (botão Pausar). */
  pausedByUser: boolean;
  /** @deprecated Use pausedByUser — mantido para compatibilidade. */
  paused: boolean;
  /** Retentativa automática após falha temporária. */
  retrying: boolean;
  phase: UploadSessionPhase;
  resuming: boolean;
  speedMode: UploadSpeedMode;
  progress: UploadEngineProgress | null;
  progressMap: Record<string, number>;
  fileRuntime: Record<string, UploadFileRuntimeState>;
  message: string | null;
  validationPreview: ValidationPreview | null;
  uploadLimits: UploadLimits | null;
  config: UploadSessionConfig | null;
  /** Arquivos ainda estão na memória — dá para retomar sem reescolher no disco. */
  canResumeWithoutPicker: boolean;
  /** Faltam vídeos na sessão — precisa abrir seletor de arquivos. */
  needsFileReselection: boolean;
  engineStarting: boolean;
  recoveringFromStall: boolean;
  batchStalled: boolean;
  concurrencyReduced: boolean;
  batchHealthMessage: string | null;
  adaptiveEffectiveMode: AdaptiveEffectiveMode;
  adaptiveStability: AdaptiveStabilityStatus;
  adaptiveActionMessage: string | null;
  adaptiveReason: string | null;
  safeMode: boolean;
  uploadPausedByFailures: boolean;
  effectiveConcurrency: number;
};
