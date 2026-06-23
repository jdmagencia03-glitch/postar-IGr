"use client";

import { UploadEngine, type UploadEngineProgress } from "@/lib/upload/engine";
import {
  buildFileMapFromRecords,
  cancelUploadBatch,
  clearAccountUploadedVideosClient,
  deleteAccountUploadBatchesClient,
  createUploadBatch,
  appendFilesToUploadBatch,
  ensureBatchWithFiles,
  fetchActiveBatch,
  fetchUploadBatchStatus,
  fileFingerprint,
  findRecordForUpload,
  matchFileToRecord,
  refreshUploadBatch,
  resetFailedUploadFile,
  setBatchPaused,
  setBatchSpeedMode,
} from "@/lib/upload/client";
import { formatUploadErrorMessage, humanizeFetchError } from "@/lib/upload/errors";
import {
  logUploadEvent,
  retryMessage,
  type UploadErrorKind,
} from "@/lib/upload/network-retry";
import {
  clearManifestBatch,
  getManifestForBatch,
  matchFilesToManifest,
  saveManifestEntries,
} from "@/lib/upload/manifest-store";
import {
  batchNeedsPolling,
  isTerminalRemoteBatchStatus,
  reconcileUploadBatchState,
} from "@/lib/upload/batch-status";
import { resetUploadBatchStatsMonotonic } from "@/lib/upload/batch-stats";
import {
  cleanupStaleTusEntries,
  applyMonotonicFilePercent,
  resetProgressGuardForBatch,
  setActiveUploadBatchId,
  validateBatchProgressEvent,
  validateFileProgressEvent,
} from "@/lib/upload/progress-guard";
import {
  getSpeedPresets,
  UPLOAD_BATCH_STALL_TIMEOUT_MS,
  UPLOAD_BATCH_WATCHDOG_INTERVAL_MS,
  UPLOAD_FILE_CONCURRENCY,
  UPLOAD_NEAR_COMPLETE_PERCENT,
  UPLOAD_NEAR_COMPLETE_STALL_MS,
  UPLOAD_STALL_TIMEOUT_MS,
  MAX_VIDEOS_PER_BATCH,
} from "@/lib/upload/storage-config";
import type { UploadSessionConfig, UploadLimits, UploadSessionSnapshot, UploadSessionPhase, ValidationPreview, UploadFileRuntimeState } from "@/lib/upload/session-types";
import { validateFiles } from "@/lib/upload/validate";
import type { UploadBatch, UploadBatchFile, UploadSpeedMode } from "@/lib/types";
import { formatBytes } from "@/lib/upload/validate";
import { reportClientOperationalError } from "@/lib/operations/report-client-error";
import { reconcileUploadState, createUploadWorkerId } from "@/lib/upload/reconcile-state";
import { reconcileBatchStructuralState } from "@/lib/upload/resilience";
import {
  claimBackoffWithJitter,
  isClaimConflictMessage,
  UPLOAD_CLAIM_BACKOFF_MS,
  type UploadClaimConflictError,
} from "@/lib/upload/claim-conflict";
import { isUploadDebugEnabled } from "@/lib/upload/debug";
import { largeBatchWarning, recommendUploadSpeedMode } from "@/lib/upload/queue";
import {
  ADAPTIVE_RETRY_WINDOW_MS,
  countBatchFileStatuses,
  evaluateAdaptiveUpload,
  initialAdaptiveEffectiveMode,
  largeBatchAdaptiveMessage,
  type AdaptiveEffectiveMode,
  type AdaptiveStabilityStatus,
} from "@/lib/upload/adaptive";

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
  speedMode: UploadSpeedMode = "adaptive";
  progress: UploadEngineProgress | null = null;
  progressMap: Record<string, number> = {};
  fileRuntime: Record<string, UploadFileRuntimeState> = {};
  message: string | null = null;
  validationPreview: ValidationPreview | null = null;
  batchHealthMessage: string | null = null;
  adaptiveEffectiveMode: AdaptiveEffectiveMode = "normal";
  adaptiveStability: AdaptiveStabilityStatus = "stable";
  adaptiveActionMessage: string | null = null;
  adaptiveReason: string | null = null;
  safeMode = false;
  uploadPausedByFailures = false;

  private snapshot: UploadSessionSnapshot = this.buildSnapshot();

  private progressFrame: number | null = null;
  private pendingProgress: UploadEngineProgress | null = null;
  private initialized = false;
  private autoRetryPass = 0;
  private engineStarting = false;
  private autoRecoveryTimer: ReturnType<typeof setTimeout> | null = null;
  private autoRecoveryScheduled = false;
  private autoRecoveryInProgress = new Set<string>();
  private claimConflictTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private reconcileNetworkBackoffMs = 0;
  private reconcileNetworkErrorAt = 0;
  private autoRetryResetTimer: ReturnType<typeof setTimeout> | null = null;
  private stallWatchdogTimer: ReturnType<typeof setInterval> | null = null;
  private retryCountdownTimer: ReturnType<typeof setInterval> | null = null;
  private reconcilePolling = false;
  private pollingTimer: ReturnType<typeof setTimeout> | null = null;
  private pollingBatchId: string | null = null;
  private pollingLifecycleAttached = false;
  private lastProgressAt = 0;
  private lastProgressBytes = 0;
  private lastCompletedCount = 0;
  private lastSettledCount = 0;
  private lastBatchAdvanceAt = 0;
  private batchStalled = false;
  private concurrencyReduced = false;
  private stallRecoveryCount = 0;
  private recoveringFromStall = false;
  private batchWatchdogTimer: ReturnType<typeof setInterval> | null = null;
  private nearCompleteWatchdogTimer: ReturnType<typeof setInterval> | null = null;
  private nearCompleteSince = new Map<string, number>();
  private stopNearCompleteWatchdog() {
    if (this.nearCompleteWatchdogTimer) {
      clearInterval(this.nearCompleteWatchdogTimer);
      this.nearCompleteWatchdogTimer = null;
    }
    this.nearCompleteSince.clear();
  }

  private startNearCompleteWatchdog(batchId: string) {
    this.stopNearCompleteWatchdog();
    this.nearCompleteWatchdogTimer = setInterval(() => {
      void this.checkNearCompleteStalledFiles(batchId);
    }, 15_000);
  }

  private async checkNearCompleteStalledFiles(batchId: string) {
    if (!this.batch || this.batch.id !== batchId) return;
    if (!validateBatchProgressEvent(batchId)) return;

    const now = Date.now();
    for (const file of this.batch.upload_files ?? []) {
      if (file.removed || file.status === "completed" || file.status === "failed") {
        this.nearCompleteSince.delete(file.id);
        continue;
      }

      const percent = applyMonotonicFilePercent(
        batchId,
        file.id,
        this.progressMap[file.id] ?? 0,
        { source: "near_complete_watchdog" },
      );

      if (percent < UPLOAD_NEAR_COMPLETE_PERCENT) {
        this.nearCompleteSince.delete(file.id);
        continue;
      }

      const since = this.nearCompleteSince.get(file.id) ?? now;
      if (!this.nearCompleteSince.has(file.id)) {
        this.nearCompleteSince.set(file.id, since);
        continue;
      }

      if (now - since < UPLOAD_NEAR_COMPLETE_STALL_MS) continue;

      this.setFileRuntime(file.id, {
        status: "completed_local_pending_server_confirm",
        message: "Aguardando confirmação do servidor…",
      });
      this.logUpload("near_complete_stall", { batchId, fileId: file.id, percent });
      await this.reconcileAndMaybeContinue(file.id, "near_complete_stall");
      this.nearCompleteSince.delete(file.id);
    }
  }

  private teardownUploadSessionTimers() {
    this.stopStallWatchdog();
    this.stopBatchWatchdog();
    this.stopAdaptiveMonitor();
    this.stopNearCompleteWatchdog();
    this.stopRetryCountdown();
    this.stopPolling();
    if (this.autoRecoveryTimer) {
      clearTimeout(this.autoRecoveryTimer);
      this.autoRecoveryTimer = null;
    }
    this.autoRecoveryScheduled = false;
    for (const timer of this.claimConflictTimers.values()) {
      clearTimeout(timer);
    }
    this.claimConflictTimers.clear();
  }

  private workerId: string | null = null;
  private serverReconcileTick = 0;
  private recentRetryTimestamps: number[] = [];
  private lastCompletionAt = 0;
  private adaptiveEvalTimer: ReturnType<typeof setInterval> | null = null;
  private lastAdaptiveEvalAt = 0;
  private lastStallRecoveryAt = 0;
  private lastRecoveredMessageAt = 0;
  private static readonly MAX_CLAIM_CONFLICT_ATTEMPTS = UPLOAD_CLAIM_BACKOFF_MS.length;
  private static readonly MAX_AUTO_RETRY_PASSES = 10;
  private static readonly AUTO_RETRY_RESET_MS = 60_000;
  private static readonly STALL_CHECK_INTERVAL_MS = 10_000;
  /** Evita abortar/reiniciar o motor em loop quando a conexão é lenta mas ainda envia bytes. */
  private static readonly STALL_RECOVERY_COOLDOWN_MS = 120_000;
  /** Bytes recentes = upload ativo; não recuperar só porque nenhum arquivo terminou ainda. */
  private static readonly RECENT_BYTE_PROGRESS_MS = 180_000;
  private static readonly POLL_INTERVAL_NORMAL_MS = 10_000;
  private static readonly POLL_INTERVAL_FAST_MS = 5_000;
  private static readonly POLL_INTERVAL_HIDDEN_MS = 30_000;

  private logUpload(event: string, detail?: Record<string, unknown>) {
    if (!isUploadDebugEnabled()) {
      const noisy =
        event === "adaptive_eval" ||
        event === "batch_reconcile" ||
        event.startsWith("auto_") ||
        event === "engine_start" ||
        event === "start_engine_blocked";
      if (noisy) return;
    }
    if (typeof console !== "undefined") {
      console.info(`[upload-session] ${event}`, detail ?? "");
    }
  }

  private touchProgress(bytesUploaded?: number) {
    this.lastProgressAt = Date.now();
    if (bytesUploaded != null) {
      this.lastProgressBytes = bytesUploaded;
    }
    this.batchStalled = false;
  }

  private hasRecentByteProgress(withinMs = UploadSessionStore.RECENT_BYTE_PROGRESS_MS) {
    return Date.now() - this.lastProgressAt < withinMs;
  }

  private canRunStallRecovery(idleMs: number) {
    const sinceLastRecovery = Date.now() - this.lastStallRecoveryAt;
    if (sinceLastRecovery < UploadSessionStore.STALL_RECOVERY_COOLDOWN_MS) {
      return idleMs >= UPLOAD_BATCH_STALL_TIMEOUT_MS * 1.5;
    }
    return true;
  }

  private touchBatchAdvance(completed: number, failed = 0) {
    const settled = completed + failed;
    if (settled > this.lastSettledCount) {
      this.lastSettledCount = settled;
      if (completed > this.lastCompletedCount) {
        this.lastCompletionAt = Date.now();
      }
      this.lastCompletedCount = completed;
      this.lastBatchAdvanceAt = Date.now();
      this.batchStalled = false;
      this.autoRetryPass = 0;
      this.touchProgress();
      this.logUpload("batch_advance", { completed, failed, settled });
    }
  }

  private touchBatchAdvanceFromBatch(batch: UploadBatch) {
    const completed = this.countCompletedFiles(batch);
    const failed =
      batch.upload_files?.filter((file) => !file.removed && file.status === "failed").length ??
      batch.failed_files ??
      0;
    this.touchBatchAdvance(completed, failed);
  }

  private getConcurrencyConfig() {
    return this.uploadLimits?.concurrency ?? UPLOAD_FILE_CONCURRENCY;
  }

  private initAdaptiveForBatch(fileCount: number) {
    if (this.speedMode === "adaptive") {
      this.adaptiveEffectiveMode = initialAdaptiveEffectiveMode(fileCount);
      this.adaptiveStability = "stable";
      this.adaptiveActionMessage = null;
      this.adaptiveReason = null;
    }
  }

  getEffectiveFileConcurrency(): number {
    const presets = this.speedPresets;
    const effective = this.adaptiveEffectiveMode ?? "normal";
    if (this.safeMode) {
      return presets.economy.fileConcurrency;
    }
    if (this.speedMode === "adaptive") {
      return presets[effective].fileConcurrency;
    }
    return presets[this.speedMode]?.fileConcurrency ?? presets.normal.fileConcurrency;
  }

  private startAdaptiveMonitor() {
    this.stopAdaptiveMonitor();
    this.adaptiveEvalTimer = setInterval(() => {
      this.evaluateAndApplyAdaptive("interval");
    }, 15_000);
  }

  private stopAdaptiveMonitor() {
    if (this.adaptiveEvalTimer) {
      clearInterval(this.adaptiveEvalTimer);
      this.adaptiveEvalTimer = null;
    }
  }

  private evaluateAndApplyAdaptive(source: string) {
    if (!this.batch || this.batch.status === "ready" || this.batch.status === "cancelled") {
      return;
    }

    const now = Date.now();
    if (source === "progress" && now - this.lastAdaptiveEvalAt < 5_000) {
      return;
    }
    this.lastAdaptiveEvalAt = now;
    this.recentRetryTimestamps = this.recentRetryTimestamps.filter(
      (at) => now - at < ADAPTIVE_RETRY_WINDOW_MS,
    );

    const files = (this.batch.upload_files ?? []).filter((file) => !file.removed);
    const counts = countBatchFileStatuses(files);
    const wasSafe = this.safeMode;
    const prevEffective = this.adaptiveEffectiveMode;

    const evaluation = evaluateAdaptiveUpload(
      {
        ...counts,
        recentRetryCount: this.recentRetryTimestamps.length,
        speedBps30s: this.progress?.speedBps30s ?? 0,
        speedBps2m: this.progress?.speedBps2m ?? 0,
        hasActiveProgress: this.progress?.hasByteProgress ?? false,
        lastProgressAt: this.lastProgressAt || null,
        lastCompletionAt: this.lastCompletionAt || null,
        currentEffectiveMode: this.adaptiveEffectiveMode,
        safeMode: this.safeMode,
        userSelectedMode: this.speedMode,
      },
      this.getConcurrencyConfig(),
    );

    this.adaptiveStability = evaluation.stability;
    this.adaptiveReason = evaluation.reason;
    if (evaluation.isStalled) {
      this.batchStalled = true;
    } else if (this.hasRecentByteProgress() || this.running) {
      this.batchStalled = false;
    }

    if (!evaluation.shouldPauseUploads && evaluation.stability === "stable") {
      this.uploadPausedByFailures = false;
    }

    if (this.speedMode === "adaptive") {
      if (evaluation.effectiveMode !== this.adaptiveEffectiveMode) {
        this.adaptiveEffectiveMode = evaluation.effectiveMode;
        this.concurrencyReduced = true;
        if (this.running && this.engine) {
          this.engine.setConcurrency(evaluation.targetConcurrency);
        }
      }
      this.adaptiveActionMessage = evaluation.actionMessage;
    }

    if (evaluation.userMessage) {
      if (
        evaluation.shouldPauseUploads ||
        evaluation.shouldEnterSafeMode ||
        evaluation.shouldReduce ||
        evaluation.shouldSuggestRecover ||
        evaluation.shouldAlertLight
      ) {
        this.message = evaluation.userMessage;
      }
    }

    if (evaluation.actionMessage && !this.message?.includes(evaluation.actionMessage)) {
      this.message = evaluation.actionMessage;
    }

    if (evaluation.shouldReduce && prevEffective !== evaluation.effectiveMode) {
      void reportClientOperationalError({
        errorType: "upload_adaptive_reduced",
        title: "Upload adaptativo reduziu velocidade",
        message: evaluation.actionMessage ?? evaluation.userMessage ?? "Velocidade reduzida.",
        probableCause: evaluation.reason ?? "Instabilidade detectada no lote.",
        recommendedAction: "Aguarde a estabilização ou use Recuperar upload.",
        uploadBatchId: this.batch.id,
        accountId:
          this.batch.platform === "tiktok"
            ? (this.batch.tiktok_account_id ?? undefined)
            : (this.batch.account_id ?? undefined),
        platform: this.batch.platform,
        metadata: { source, ...evaluation },
      });
    }

    if (evaluation.shouldEnterSafeMode && !wasSafe) {
      void reportClientOperationalError({
        errorType: "upload_safe_mode",
        title: "Modo seguro de upload ativado",
        message: evaluation.userMessage ?? "Modo seguro ativado.",
        probableCause: `${counts.failed} falhas no lote.`,
        recommendedAction: "Continue com modo seguro ou recupere o lote.",
      uploadBatchId: this.batch.id,
      metadata: { source, failed: counts.failed },
      });
    }

    this.logUpload("adaptive_eval", { source, evaluation });
    this.emit();
  }

  private countCompletedFiles(batch: UploadBatch | null = this.batch) {
    return (
      batch?.upload_files?.filter((file) => !file.removed && file.status === "completed").length ??
      batch?.completed_files ??
      0
    );
  }

  private pendingWorkInSession(batch: UploadBatch | null = this.batch) {
    return (
      batch?.upload_files?.filter(
        (file) =>
          !file.removed &&
          file.status !== "completed" &&
          file.status !== "failed" &&
          this.lastFileMap.has(file.id),
      ) ?? []
    );
  }

  private startBatchWatchdog() {
    this.stopBatchWatchdog();
    this.lastCompletedCount = this.countCompletedFiles();
    this.lastBatchAdvanceAt = Date.now();

    this.batchWatchdogTimer = setInterval(() => {
      void this.checkBatchHealth();
    }, UPLOAD_BATCH_WATCHDOG_INTERVAL_MS);
  }

  private stopBatchWatchdog() {
    if (this.batchWatchdogTimer) {
      clearInterval(this.batchWatchdogTimer);
      this.batchWatchdogTimer = null;
    }
  }

  private async checkBatchHealth() {
    if (!this.batch || this.batch.status === "ready" || this.batch.status === "cancelled") {
      return;
    }
    if (this.pausedByUser || this.recoveringFromStall || this.uploadPausedByFailures) return;

    const completed = this.progress?.completed ?? this.countCompletedFiles();
    const failed =
      this.batch?.upload_files?.filter((f) => !f.removed && f.status === "failed").length ??
      this.progress?.failed ??
      0;
    this.touchBatchAdvance(completed, failed);

    const pendingWork = this.pendingWorkInSession();
    if (!pendingWork.length) {
      this.batchStalled = false;
      return;
    }

    const idleMs = Date.now() - this.lastBatchAdvanceAt;
    const retryingOnly =
      (this.hasActiveFileRetry() || this.retrying) &&
      idleMs < UPLOAD_BATCH_STALL_TIMEOUT_MS + UPLOAD_STALL_TIMEOUT_MS;

    if (idleMs < UPLOAD_BATCH_STALL_TIMEOUT_MS || retryingOnly) {
      return;
    }

    if (this.running && this.hasRecentByteProgress()) {
      return;
    }

    if (!this.canRunStallRecovery(idleMs)) {
      return;
    }

    if (this.uploadPausedByFailures) {
      return;
    }

    this.batchStalled = true;
    this.logUpload("batch_stalled", {
      batchId: this.batch.id,
      idleMs,
      completed,
      pending: pendingWork.length,
      running: this.running,
    });

    if (this.running) {
      await this.recoverFromStall(idleMs);
      return;
    }

    if (this.lastFileMap.size > 0) {
      await this.recoverBatchUpload("batch_watchdog");
    }
    this.evaluateAndApplyAdaptive("batch_watchdog");
  }

  private reduceConcurrencyOnInstability() {
    const order: UploadSpeedMode[] = ["turbo", "normal", "economy"];
    const idx = order.indexOf(this.speedMode);
    if (idx >= order.length - 1) return;

    const next = order[idx + 1]!;
    this.stallRecoveryCount += 1;
    this.concurrencyReduced = true;
    this.logUpload("concurrency_reduced", {
      from: this.speedMode,
      to: next,
      stallRecoveryCount: this.stallRecoveryCount,
    });
    this.setSpeedMode(next);
    this.message =
      "Detectamos instabilidade no envio. Reduzimos temporariamente a velocidade para manter o lote estável.";
    void reportClientOperationalError({
      errorType: "upload_concurrency_reduced",
      title: "Velocidade de upload reduzida automaticamente",
      message: this.message,
      probableCause: "Muitas falhas, timeouts ou travamentos no lote.",
      recommendedAction: "Aguarde a recuperação automática ou use Recuperar upload.",
      uploadBatchId: this.batch?.id,
      accountId:
        this.batch?.platform === "tiktok"
          ? (this.batch.tiktok_account_id ?? undefined)
          : (this.batch?.account_id ?? undefined),
      platform: this.batch?.platform,
      metadata: { from: order[idx], to: next, stallRecoveryCount: this.stallRecoveryCount },
    });
  }

  async recoverBatchUpload(reason = "manual_recover") {
    if (!this.batch || this.pausedByUser || this.recoveringFromStall) return;
    if (!this.canRunStallRecovery(UPLOAD_BATCH_STALL_TIMEOUT_MS)) return;

    this.lastStallRecoveryAt = Date.now();
    this.recoveringFromStall = true;
    this.batchStalled = true;
    this.message = "Upload travado detectado. Tentando recuperar…";
    this.logUpload("batch_recover_start", { batchId: this.batch.id, reason });
    this.emit();

    const batchId = this.batch.id;
    const fileMap = this.lastFileMap;

    this.engine?.abortAll();
    this.engine?.stop();
    this.engine = null;
    this.running = false;
    this.engineStarting = false;
    this.fileRuntime = {};
    this.stopRetryCountdown();

    try {
      if (reason === "manual_recover") {
        this.uploadPausedByFailures = false;
        this.safeMode = false;
      }
      if (reason !== "manual_recover" && this.stallRecoveryCount < 3) {
        if (this.speedMode === "adaptive") {
          this.evaluateAndApplyAdaptive("recover");
        } else {
          this.reduceConcurrencyOnInstability();
        }
      }

      const reconciled = await reconcileBatchStructuralState(batchId);
      this.syncBatch(reconciled.batch);
      this.batchHealthMessage = reconciled.health.isStalled
        ? reconciled.health.recommendedAction
        : null;
      this.lastBatchAdvanceAt = Date.now();
      this.autoRetryPass = 0;

      if (reconciled.releasedLeases > 0) {
        this.logUpload("batch_reconcile", {
          releasedLeases: reconciled.releasedLeases,
          health: reconciled.health,
        });
      }

      if (fileMap.size > 0 && reconciled.batch.status !== "ready") {
        this.message = reconciled.health.isStalled
          ? "Reconciliando e continuando envio…"
          : "Continuando envio…";
        this.emit();
        await this.autoContinuePendingIfNeeded(batchId, fileMap, reason);
      }
    } catch (error) {
      this.message = error instanceof Error ? error.message : "Falha ao recuperar upload";
    } finally {
      this.recoveringFromStall = false;
      this.batchStalled = false;
      this.logUpload("batch_recovered", { batchId, reason });
      this.emit();
    }
  }

  private async reconcileBatchFromServer(batchId: string) {
    const now = Date.now();
    if (
      this.reconcileNetworkBackoffMs > 0 &&
      now - this.reconcileNetworkErrorAt < this.reconcileNetworkBackoffMs
    ) {
      return null;
    }

    try {
      const reconciled = await reconcileBatchStructuralState(batchId);
      this.reconcileNetworkBackoffMs = 0;
      this.syncBatch(reconciled.batch);
      if (reconciled.health.isStalled || reconciled.health.isDegraded) {
        this.batchStalled = reconciled.health.isStalled;
        this.batchHealthMessage = reconciled.health.recommendedAction;
      }
      this.evaluateAndApplyAdaptive("server_reconcile");
      return reconciled;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const isNetwork =
        /failed to fetch|network|connection|err_connection|aborted/i.test(message);
      if (isNetwork) {
        this.reconcileNetworkErrorAt = now;
        this.reconcileNetworkBackoffMs = Math.min(
          60_000,
          (this.reconcileNetworkBackoffMs || 5_000) * 2,
        );
      }
      this.logUpload("reconcile_failed", {
        batchId,
        error: message,
        backoffMs: this.reconcileNetworkBackoffMs,
      });
      return null;
    }
  }

  private stopRetryCountdown() {
    if (this.retryCountdownTimer) {
      clearInterval(this.retryCountdownTimer);
      this.retryCountdownTimer = null;
    }
  }

  private clearFileRuntime(fileId: string) {
    if (!this.fileRuntime[fileId]) return;
    const next = { ...this.fileRuntime };
    delete next[fileId];
    this.fileRuntime = next;
  }

  private setFileRuntime(fileId: string, patch: UploadFileRuntimeState) {
    this.fileRuntime = {
      ...this.fileRuntime,
      [fileId]: { ...this.fileRuntime[fileId], ...patch },
    };
  }

  private handleFileRetryScheduled(
    fileId: string,
    detail: {
      attempt: number;
      maxAttempts: number;
      delayMs: number;
      errorMessage: string;
      errorKind: string;
    },
  ) {
    this.recentRetryTimestamps.push(Date.now());
    this.touchProgress();
    const endsAt = Date.now() + detail.delayMs;
    this.setFileRuntime(fileId, {
      status: "retrying",
      attempt: detail.attempt,
      maxAttempts: detail.maxAttempts,
      nextRetryAt: endsAt,
      retryInMs: detail.delayMs,
      message: detail.errorMessage,
    });
    this.message = retryMessage({
      attempt: detail.attempt,
      maxAttempts: detail.maxAttempts,
      delayMs: detail.delayMs,
      kind: detail.errorKind as UploadErrorKind,
    });
    this.evaluateAndApplyAdaptive("file_retry");
    this.stopRetryCountdown();
    this.retryCountdownTimer = setInterval(() => {
      const remaining = Math.max(0, endsAt - Date.now());
      if (remaining <= 0) {
        this.stopRetryCountdown();
        return;
      }
      const seconds = Math.max(1, Math.ceil(remaining / 1000));
      this.message = retryMessage({
        attempt: detail.attempt,
        maxAttempts: detail.maxAttempts,
        delayMs: seconds * 1000,
        kind: detail.errorKind as UploadErrorKind,
      });
      this.setFileRuntime(fileId, { retryInMs: remaining });
      this.emit();
    }, 1000);
    logUploadEvent("[upload-retry]", "ui_scheduled", {
      batchId: this.batch?.id,
      fileId,
      attempt: detail.attempt,
      maxAttempts: detail.maxAttempts,
      nextRetryIn: detail.delayMs,
    });
    this.emit();
  }

  private handleFileRecovered(fileId: string) {
    this.stopRetryCountdown();
    this.clearFileRuntime(fileId);
    const now = Date.now();
    if (now - this.lastRecoveredMessageAt > 30_000) {
      this.message = "Continuando envio…";
      this.lastRecoveredMessageAt = now;
    }
    logUploadEvent("[upload-recovered]", "file_recovered", {
      batchId: this.batch?.id,
      fileId,
    });
    this.emit();
  }

  private hasActiveFileRetry() {
    return Object.values(this.fileRuntime).some((runtime) => runtime.status === "retrying");
  }

  private startStallWatchdog() {
    this.stopStallWatchdog();
    this.touchProgress(this.progress?.bytesUploaded ?? 0);

    this.stallWatchdogTimer = setInterval(() => {
      if (!this.running || this.pausedByUser || this.recoveringFromStall) {
        return;
      }

      const idleMs = Date.now() - this.lastProgressAt;
      const batchIdleMs = Date.now() - this.lastBatchAdvanceAt;
      const byteStall = idleMs >= UPLOAD_STALL_TIMEOUT_MS;
      const batchStall = batchIdleMs >= UPLOAD_BATCH_STALL_TIMEOUT_MS;
      const recentBytes = this.hasRecentByteProgress();

      if (byteStall || (batchStall && !recentBytes)) {
        const stallMs = Math.max(idleMs, batchIdleMs);
        if (this.canRunStallRecovery(stallMs)) {
          void this.recoverFromStall(stallMs);
        }
      }
    }, UploadSessionStore.STALL_CHECK_INTERVAL_MS);
  }

  private stopStallWatchdog() {
    if (this.stallWatchdogTimer) {
      clearInterval(this.stallWatchdogTimer);
      this.stallWatchdogTimer = null;
    }
  }

  private async recoverFromStall(idleMs: number) {
    if (!this.running || this.pausedByUser || this.recoveringFromStall || this.uploadPausedByFailures || !this.batch) return;
    if (!this.canRunStallRecovery(idleMs)) return;
    if (this.hasRecentByteProgress() && idleMs < UPLOAD_STALL_TIMEOUT_MS) return;

    this.lastStallRecoveryAt = Date.now();
    this.recoveringFromStall = true;
    this.batchStalled = true;
    this.logUpload("stall_detected", {
      batchId: this.batch.id,
      idleMs,
      completed: this.progress?.completed,
    });
    this.message = "Upload instável detectado. Reduzindo velocidade e tentando recuperar…";
    this.stopStallWatchdog();

    const batchId = this.batch.id;
    const fileMap = this.lastFileMap;

    this.engine?.abortAll();
    this.engine?.stop();
    this.engine = null;
    this.running = false;
    this.engineStarting = false;
    this.fileRuntime = {};
    this.stopRetryCountdown();
    this.emit();

    try {
      this.reduceConcurrencyOnInstability();
      if (fileMap.size > 0 && !this.pausedByUser) {
        await this.reconcileBatchFromServer(batchId);
        this.message = "Continuando envio dos próximos vídeos…";
        this.emit();
        this.autoRetryPass = 0;
        await this.autoContinuePendingIfNeeded(batchId, fileMap, "stall_detected");
      }
    } finally {
      this.recoveringFromStall = false;
      this.batchStalled = false;
      this.emit();
    }
  }

  private async resetStalledUploadingFiles(
    batchId: string,
    options: { includeRetrying?: boolean } = {},
  ) {
    const refreshed = await refreshUploadBatch(batchId);
    const now = Date.now();
    const stuck =
      refreshed.upload_files?.filter((file) => {
        if (file.removed) return false;
        if (file.status === "uploading") {
          const idleMs = now - new Date(file.updated_at).getTime();
          return idleMs >= UPLOAD_STALL_TIMEOUT_MS;
        }
        if (options.includeRetrying && file.status === "retrying") {
          const idleMs = now - new Date(file.updated_at).getTime();
          return idleMs >= UPLOAD_STALL_TIMEOUT_MS;
        }
        return false;
      }) ?? [];
    if (!stuck.length) return;

    this.logUpload("reset_stalled_uploading", {
      batchId,
      count: stuck.length,
      fileIds: stuck.map((file) => file.id),
    });

    await Promise.all(
      stuck.map((file) =>
        fetch(`/api/upload/batches/${batchId}/files/${file.id}`, {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "pending" }),
        }).catch(() => undefined),
      ),
    );
  }

  private async persistManifest(batch: UploadBatch, fileMap: Map<string, File>) {
    const entries = [...fileMap.entries()]
      .map(([fileId, file]) => {
        const record = batch.upload_files?.find((item) => item.id === fileId);
        if (!record || record.status === "completed") return null;
        return {
          fileId,
          batchId: batch.id,
          name: file.name,
          size: file.size,
          lastModified: file.lastModified,
          fingerprint: record.file_hash ?? fileFingerprint(file),
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry != null);

    if (entries.length) {
      await saveManifestEntries(entries);
    }
  }

  private derivePhase(): UploadSessionPhase {
    if (!this.batch) return "idle";
    if (this.batch.status === "ready") return "completed";
    if (this.pausedByUser) return "paused_by_user";
    if (this.retrying || this.recoveringFromStall) return "retrying";
    if (this.running || this.engineStarting) return "uploading";
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
      progressMap: { ...this.progressMap },
      fileRuntime: { ...this.fileRuntime },
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
      engineStarting: this.engineStarting,
      recoveringFromStall: this.recoveringFromStall,
      batchStalled: this.batchStalled,
      concurrencyReduced: this.concurrencyReduced,
      batchHealthMessage: this.batchHealthMessage,
      adaptiveEffectiveMode: this.adaptiveEffectiveMode,
      adaptiveStability: this.adaptiveStability,
      adaptiveActionMessage: this.adaptiveActionMessage,
      adaptiveReason: this.adaptiveReason,
      safeMode: this.safeMode,
      uploadPausedByFailures: this.uploadPausedByFailures,
      effectiveConcurrency: this.getEffectiveFileConcurrency(),
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
    const prev = this.snapshot;
    const wasRunning = prev.running;
    this.snapshot = this.buildSnapshot();
    logUploadEvent("[upload-store-emit]", "emit", {
      batchId: this.batch?.id,
      listeners: this.listeners.size,
      batchListeners: this.batchListeners.size,
      running: this.running,
      retrying: this.retrying,
      phase: this.snapshot.phase,
      previousPhase: prev.phase,
      snapshotChanged: prev !== this.snapshot,
    });
    logUploadEvent("[upload-snapshot]", "built", {
      batchId: this.batch?.id,
      phase: this.snapshot.phase,
      running: this.running,
      retrying: this.retrying,
      engineStarting: this.engineStarting,
      recoveringFromStall: this.recoveringFromStall,
      batchStatus: this.batch?.status,
      completed: this.batch?.completed_files,
      failed: this.batch?.failed_files,
    });
    for (const listener of this.listeners) listener();
    if (wasRunning && !this.running) {
      this.scheduleAutoRecovery("running_stopped");
    }
  }

  private getPollingIntervalMs() {
    if (typeof document !== "undefined" && document.hidden) {
      return UploadSessionStore.POLL_INTERVAL_HIDDEN_MS;
    }

    if (this.running && !this.retrying && !this.hasActiveFileRetry()) {
      const total = this.batch?.total_files ?? 0;
      if (total > 100) return 15_000;
      return UploadSessionStore.POLL_INTERVAL_NORMAL_MS;
    }

    const files = this.batch?.upload_files ?? [];
    const hasRetryOrStall =
      this.retrying ||
      this.recoveringFromStall ||
      this.hasActiveFileRetry() ||
      files.some((file) => file.status === "retrying");

    return hasRetryOrStall
      ? UploadSessionStore.POLL_INTERVAL_FAST_MS
      : UploadSessionStore.POLL_INTERVAL_NORMAL_MS;
  }

  private shouldPoll() {
    return batchNeedsPolling(this.batch);
  }

  private clearPollingTimer() {
    if (this.pollingTimer) {
      clearTimeout(this.pollingTimer);
      this.pollingTimer = null;
    }
  }

  stopPolling() {
    this.clearPollingTimer();
    const batchId = this.pollingBatchId;
    this.pollingBatchId = null;
    if (batchId) {
      logUploadEvent("[upload-polling]", "stopped", { batchId });
    }
  }

  ensurePolling() {
    if (!this.shouldPoll()) {
      this.stopPolling();
      return;
    }

    const batchId = this.batch!.id;
    if (this.pollingBatchId === batchId && this.pollingTimer) {
      return;
    }

    this.stopPolling();
    this.pollingBatchId = batchId;
    logUploadEvent("[upload-polling]", "started", {
      batchId,
      intervalMs: this.getPollingIntervalMs(),
      hidden: typeof document !== "undefined" ? document.hidden : false,
    });
    this.scheduleNextPoll(0);
  }

  private scheduleNextPoll(delayMs?: number) {
    this.clearPollingTimer();
    if (!this.shouldPoll()) {
      this.stopPolling();
      return;
    }

    const intervalMs = delayMs ?? this.getPollingIntervalMs();
    this.pollingTimer = setTimeout(() => {
      void this.runPollingTick();
    }, intervalMs);
  }

  private async runPollingTick() {
    if (!this.shouldPoll()) {
      this.stopPolling();
      return;
    }

    logUploadEvent("[upload-polling]", "tick", {
      batchId: this.batch?.id,
      intervalMs: this.getPollingIntervalMs(),
      hidden: typeof document !== "undefined" ? document.hidden : false,
      running: this.running,
      retrying: this.retrying,
      phase: this.snapshot.phase,
    });

    await this.reconcileActiveBatch("polling");

    if (this.shouldPoll()) {
      this.scheduleNextPoll();
    } else {
      this.stopPolling();
    }
  }

  attachPollingLifecycle() {
    if (this.pollingLifecycleAttached || typeof document === "undefined") return;
    this.pollingLifecycleAttached = true;

    document.addEventListener("visibilitychange", this.handleVisibilityChange);
    window.addEventListener("focus", this.handleWindowFocus);
    this.ensurePolling();
  }

  detachPollingLifecycle() {
    if (!this.pollingLifecycleAttached || typeof document === "undefined") return;
    this.pollingLifecycleAttached = false;
    document.removeEventListener("visibilitychange", this.handleVisibilityChange);
    window.removeEventListener("focus", this.handleWindowFocus);
    this.stopPolling();
  }

  private handleVisibilityChange = () => {
    if (document.hidden) {
      this.clearPollingTimer();
      if (this.shouldPoll()) {
        this.scheduleNextPoll(this.getPollingIntervalMs());
      }
      return;
    }
    void this.reconcileOnForeground();
    this.clearPollingTimer();
    if (this.shouldPoll()) {
      this.scheduleNextPoll(0);
    }
  };

  private handleWindowFocus = () => {
    void this.reconcileOnForeground();
  };

  private scheduleAutoRecovery(reason: string) {
    if (
      this.pausedByUser ||
      this.running ||
      this.retrying ||
      this.engineStarting ||
      this.recoveringFromStall ||
      this.resuming ||
      !this.batch ||
      !this.hasPendingInSession() ||
      this.lastFileMap.size === 0 ||
      this.autoRecoveryInProgress.has(this.batch.id)
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
    const prevAccount = this.config?.accountId;
    const prevPlatform = this.config?.platform;
    this.config = config;

    if (
      config.accountId &&
      this.initialized &&
      (prevAccount !== config.accountId ||
        prevPlatform !== config.platform ||
        !this.batch ||
        this.batchBelongsToConfig(config) === false)
    ) {
      void this.reloadActiveBatchForAccount();
    }
  }

  private batchBelongsToConfig(config: UploadSessionConfig) {
    if (!this.batch) return true;
    const platform = config.platform ?? "instagram";
    if (this.batch.platform !== platform) return false;
    if (platform === "tiktok") {
      return this.batch.tiktok_account_id === config.accountId;
    }
    return this.batch.account_id === config.accountId;
  }

  private async reloadActiveBatchForAccount() {
    const config = this.config;
    if (!config?.accountId) {
      this.syncBatch(null);
      return;
    }

    try {
      const active = await fetchActiveBatch({
        summary: true,
        platform: config.platform ?? "instagram",
        accountId: config.accountId,
      });

      if (!active) {
        this.syncBatch(null);
        this.progressMap = {};
        return;
      }

      const needsFull = !active.upload_files?.length && active.total_files > 0;
      const batch = needsFull ? await refreshUploadBatch(active.id) : active;
      this.syncBatch(batch);

      if (batch.upload_speed_mode) this.speedMode = batch.upload_speed_mode;
      this.initAdaptiveForBatch(batch.total_files);
      this.pausedByUser = Boolean(batch.paused);

      const initialProgress: Record<string, number> = {};
      for (const file of batch.upload_files ?? []) {
        const uploaded = Number(file.bytes_uploaded ?? 0);
        const total = Number(file.file_size);
        if (uploaded > 0 && total > 0 && file.status !== "completed") {
          initialProgress[file.id] = Math.round((uploaded / total) * 100);
        }
      }
      this.progressMap = initialProgress;
      resetUploadBatchStatsMonotonic(batch.id);

      if (batch.status !== "ready" && batch.status !== "cancelled") {
        await this.reconcileBatchFromServer(batch.id);
      }
    } catch (error) {
      this.setUserMessage(error, "Erro ao carregar lote da conta");
    } finally {
      this.emit();
    }
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
    if (next) {
      setActiveUploadBatchId(next.id);
      this.touchBatchAdvanceFromBatch(next);
    } else {
      setActiveUploadBatchId(null);
    }
    this.batch = next;
    for (const listener of this.batchListeners) listener(next);
    this.emit();
    if (next) {
      this.ensurePolling();
      if (next.status !== "ready" && next.status !== "cancelled" && !this.batchWatchdogTimer) {
        this.startBatchWatchdog();
      }
    } else {
      this.stopBatchWatchdog();
      this.stopPolling();
    }
  }

  private get speedPresets() {
    return this.uploadLimits?.speed_presets ?? getSpeedPresets(this.uploadLimits?.concurrency);
  }

  private get maxUploadBytes() {
    return (this.uploadLimits?.max_upload_mb ?? 500) * 1024 * 1024;
  }

  private scheduleProgressUpdate = (next: UploadEngineProgress) => {
    if (!validateBatchProgressEvent(next.batchId ?? this.batch?.id)) {
      return;
    }
    this.pendingProgress = next;
    this.touchBatchAdvance(next.completed, next.failed);
    if (next.bytesUploaded > this.lastProgressBytes) {
      this.touchProgress(next.bytesUploaded);
    }
    if (this.progressFrame !== null) return;
    this.progressFrame = requestAnimationFrame(() => {
      this.progressFrame = null;
      if (!this.pendingProgress) return;
      this.progress = this.pendingProgress;
      if (this.running) {
        this.evaluateAndApplyAdaptive("progress");
      }
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
      this.message = "Não foi possível carregar limites de upload. Usando padrão de 500 MB.";
    }

    try {
      if (this.config?.accountId) {
        await this.reloadActiveBatchForAccount();
      } else {
        const active = await fetchActiveBatch({ summary: true });
        if (active) {
          const needsFull = !active.upload_files?.length && active.total_files > 0;
          this.batch = needsFull ? await refreshUploadBatch(active.id) : active;
        } else {
          this.batch = null;
        }

        if (this.batch?.upload_speed_mode) this.speedMode = this.batch.upload_speed_mode;
        if (this.batch?.paused) this.pausedByUser = true;
        if (this.batch?.upload_files?.length) {
          const initialProgress: Record<string, number> = {};
          for (const file of this.batch.upload_files) {
            const uploaded = Number(file.bytes_uploaded ?? 0);
            const total = Number(file.file_size);
            if (uploaded > 0 && total > 0 && file.status !== "completed") {
              initialProgress[file.id] = Math.round((uploaded / total) * 100);
            }
          }
          this.progressMap = initialProgress;
        }
      }

      if (this.batch && this.needsFileReselection()) {
        const completed = this.batch.completed_files ?? 0;
        const total = this.batch.total_files ?? 0;
        this.message = `${completed} de ${total} já enviados. Selecione os vídeos pendentes para continuar — eles não serão reenviados.`;
      }
    } catch (error) {
      this.setUserMessage(error, "Erro ao carregar lote");
    } finally {
      this.initialLoading = false;
      this.emit();
      this.ensurePolling();
    }
  }

  setSpeedMode(mode: UploadSpeedMode) {
    this.speedMode = mode;
    if (mode === "adaptive") {
      this.initAdaptiveForBatch(this.batch?.total_files ?? 0);
    } else if (mode !== "economy") {
      this.safeMode = false;
      this.uploadPausedByFailures = false;
    }
    if (this.running && this.engine) {
      this.engine.setConcurrency(this.getEffectiveFileConcurrency());
    }
    if (this.batch) {
      void setBatchSpeedMode(this.batch.id, mode)
        .then((updated) => {
          this.syncBatch(updated);
        })
        .catch(() => undefined);
    }
    this.emit();
  }

  private async tryAutoRetryAfterRun(batchId: string, fileMap: Map<string, File>) {
    if (
      this.pausedByUser ||
      this.cancelledBatchIds.has(batchId) ||
      fileMap.size === 0 ||
      this.autoRecoveryInProgress.has(batchId)
    ) {
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
          (file.status === "pending" || file.status === "uploading" || file.status === "retrying") &&
          fileMap.has(file.id),
      ) ?? [];

    if (!pendingInMap.length) {
      this.autoRetryPass = 0;
      if (failed.length) {
        const completed = refreshed.completed_files ?? 0;
        this.message =
          completed > 0
            ? `${failed.length} vídeo(s) falharam e foram ignorados. ${completed} prontos para agendar.`
            : `${failed.length} vídeo(s) falharam e foram ignorados.`;
        this.syncBatch(refreshed);
      }
      return;
    }

    if (this.autoRetryPass >= UploadSessionStore.MAX_AUTO_RETRY_PASSES) {
      if (!this.pausedByUser) {
        this.message = "Alguns vídeos ainda estão pendentes. Você pode agendar os enviados ou retomar depois.";
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

    this.autoRetryPass += 1;
    const retryCount = pendingInMap.length;
    const reason = "pending_stalled";
    this.logUpload("auto_retry_start", { pass: this.autoRetryPass, retryCount, reason });

    this.syncBatch(refreshed);
    await new Promise((resolve) => setTimeout(resolve, Math.min(800, 200 * this.autoRetryPass)));

    if (this.pausedByUser || this.cancelledBatchIds.has(batchId)) {
      this.emit();
      return;
    }

    await this.startEngine(refreshed, fileMap);
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
      this.uploadPausedByFailures ||
      this.cancelledBatchIds.has(batchId) ||
      fileMap.size === 0 ||
      this.autoRecoveryInProgress.has(batchId)
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
          (file.status === "pending" || file.status === "uploading" || file.status === "retrying") &&
          fileMap.has(file.id),
      ) ?? [];

    if (!pendingInMap.length) {
      if (failed.length) {
        const completed = refreshed.completed_files ?? 0;
        this.message =
          completed > 0
            ? `${failed.length} vídeo(s) falharam e foram ignorados. ${completed} prontos para agendar.`
            : `${failed.length} vídeo(s) falharam e foram ignorados.`;
        this.syncBatch(refreshed);
      }
      return;
    }

    this.logUpload("auto_continue", { reason, pending: pendingInMap.length, failed: failed.length });

    this.syncBatch(refreshed);
    await this.startEngine(refreshed, fileMap);
  }

  setValidationPreview(preview: ValidationPreview | null) {
    this.validationPreview = preview;
    this.emit();
  }

  private handleClaimConflict(fileId: string, error: UploadClaimConflictError) {
    const prevAttempts = this.fileRuntime[fileId]?.claimAttempts ?? 0;
    const attempt = prevAttempts + 1;
    const maxAttempts = UploadSessionStore.MAX_CLAIM_CONFLICT_ATTEMPTS;

    this.setFileRuntime(fileId, {
      status: error.payload.isStale ? "reconciling" : "waiting_claim",
      claimAttempts: attempt,
      message: "Aguardando reconciliação do upload…",
    });
    this.message = "Aguardando reconciliação do upload…";
    this.emit();

    if (attempt >= maxAttempts) {
      this.uploadPausedByFailures = true;
      this.message = 'Upload pausado para segurança. Clique em "Retomar upload".';
      this.emit();
      return;
    }

    const delayMs = error.payload.retryAfterMs || claimBackoffWithJitter(attempt - 1);
    const existing = this.claimConflictTimers.get(fileId);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      this.claimConflictTimers.delete(fileId);
      if (this.pausedByUser || !this.batch) return;
      this.setFileRuntime(fileId, { status: "reconciling" });
      void this.reconcileAndMaybeContinue(fileId, "claim_conflict");
    }, delayMs);
    this.claimConflictTimers.set(fileId, timer);
  }

  private handleLocalCompletedPending(fileId: string) {
    this.setFileRuntime(fileId, {
      status: "completed_local_pending_server_confirm",
      message: "Aguardando confirmação…",
    });
    this.emit();
    void this.reconcileAndMaybeContinue(fileId, "tus_completed_pending");
  }

  private async reconcileAndMaybeContinue(fileId: string, source: string) {
    if (!this.batch) return;
    try {
      await this.reconcileBatchFromServer(this.batch.id);
    } catch {
      this.setFileRuntime(fileId, {
        status: "reconcile_network_error",
        message: "Aguardando confirmação…",
      });
      this.emit();
      return;
    }

    const file = this.batch.upload_files?.find((item) => item.id === fileId);
    if (file?.status === "completed") {
      this.clearFileRuntime(fileId);
      this.emit();
      return;
    }

    if (
      file &&
      (file.status === "pending" || file.status === "retrying") &&
      this.lastFileMap.has(fileId) &&
      !this.running &&
      !this.engineStarting &&
      !this.pausedByUser
    ) {
      await this.startEngine(this.batch, this.lastFileMap, [fileId]);
    }
  }

  private async startEngine(
    currentBatch: UploadBatch,
    fileMap: Map<string, File>,
    onlyFileIds?: string[],
  ) {
    if (this.engineStarting || this.running) {
      this.logUpload("start_engine_blocked", { batchId: currentBatch.id, reason: "already_starting" });
      return;
    }
    if (this.autoRecoveryInProgress.has(currentBatch.id)) {
      this.logUpload("start_engine_blocked", { batchId: currentBatch.id, reason: "auto_recovery_active" });
      return;
    }
    this.engineStarting = true;
    this.autoRecoveryInProgress.add(currentBatch.id);
    const batchId = currentBatch.id;
    this.workerId = createUploadWorkerId();

    const totalActive = (currentBatch.upload_files ?? []).filter((f) => !f.removed).length;
    this.initAdaptiveForBatch(totalActive);
    const adaptiveWarning = largeBatchAdaptiveMessage(totalActive) ?? largeBatchWarning(totalActive);
    if (adaptiveWarning && !this.message) {
      this.message = adaptiveWarning;
    }

    this.evaluateAndApplyAdaptive("engine_prepare");

    if (this.uploadPausedByFailures && !onlyFileIds?.length) {
      this.engineStarting = false;
      this.autoRecoveryInProgress.delete(batchId);
      this.message =
        "Envio pausado. Clique em Recuperar upload para continuar os vídeos pendentes.";
      this.emit();
      return;
    }

    try {
      const batchWithFiles = await ensureBatchWithFiles(currentBatch);
      if (batchWithFiles !== currentBatch) {
        this.syncBatch(batchWithFiles);
        currentBatch = batchWithFiles;
      }

      this.engine?.stop();
      const engine = new UploadEngine(this.getEffectiveFileConcurrency(), {
        onProgress: this.scheduleProgressUpdate,
        onBatchUpdate: (next) => {
          if (!validateBatchProgressEvent(next.id)) return;
          if (this.cancelledBatchIds.has(next.id)) return;
          this.batch = next;
          for (const listener of this.batchListeners) listener(next);
          this.emit();
          this.ensurePolling();
        },
        onFileProgress: (fileId, loaded, total) => {
          if (!validateFileProgressEvent(batchId, fileId)) return;
          const percent = Math.round((loaded / total) * 100);
          this.touchProgress();
          const prev = this.progressMap[fileId] ?? 0;
          const next = applyMonotonicFilePercent(batchId, fileId, Math.max(prev, percent), {
            source: "onFileProgress",
          });
          if (next !== prev) {
            this.progressMap = { ...this.progressMap, [fileId]: next };
            this.emit();
          }
        },
        onFileRetryScheduled: (fileId, detail) => this.handleFileRetryScheduled(fileId, detail),
        onFileRecovered: (fileId) => this.handleFileRecovered(fileId),
        onClaimConflict: (fileId, error) => this.handleClaimConflict(fileId, error),
        onLocalCompletedPending: (fileId) => this.handleLocalCompletedPending(fileId),
        onComplete: async (latest) => {
          if (this.cancelledBatchIds.has(latest.id)) return;
          const refreshed = await refreshUploadBatch(latest.id);
          if (this.cancelledBatchIds.has(latest.id) || refreshed.status === "cancelled") return;
          this.syncBatch(refreshed);
          if (refreshed.status === "ready") {
            this.autoRetryPass = 0;
            this.stopRetryCountdown();
            this.fileRuntime = {};
            this.message = "Upload concluído com sucesso. A IA pode agendar suas publicações.";
          }
          this.emit();
        },
        onError: (errorMessage, fileId) => {
          if (isClaimConflictMessage(errorMessage)) {
            if (fileId) {
              this.setFileRuntime(fileId, {
                status: "waiting_claim",
                message: "Aguardando reconciliação do upload…",
              });
            }
            this.message = "Aguardando reconciliação do upload…";
            this.emit();
            return;
          }
          this.logUpload("file_error", { message: errorMessage, fileId });
          if (fileId) this.clearFileRuntime(fileId);
          const isStallLike = /upload_stall|sem progresso|stall_timeout|upload travado/i.test(
            errorMessage.toLowerCase(),
          );
          if (isStallLike) {
            this.message =
              "Upload sem progresso detectado. Tentando recuperar este arquivo…";
            this.emit();
            return;
          }
          const failedCount =
            this.batch?.upload_files?.filter((f) => !f.removed && f.status === "failed").length ?? 0;
          this.message =
            failedCount > 0
              ? `${failedCount} vídeo(s) falhou(aram) após várias tentativas. O restante do lote continuará normalmente.`
              : `Não foi possível continuar este vídeo. Você pode tentar reenviar apenas os arquivos com erro.`;
          this.emit();
        },
        onEngineIdle: async (latest) => {
          await this.reconcileBatchFromServer(batchId).catch(() => undefined);
          const orphaned =
            latest.upload_files?.filter(
              (file) =>
                !file.removed &&
                (file.status === "uploading" || file.status === "retrying") &&
                fileMap.has(file.id) &&
                !this.fileRuntime[file.id]?.status?.startsWith("completed_local"),
            ) ?? [];
          if (orphaned.length && !this.pausedByUser && !this.cancelledBatchIds.has(batchId)) {
            this.logUpload("engine_idle_orphans", {
              batchId,
              count: orphaned.length,
              fileIds: orphaned.map((file) => file.id),
            });
            await this.resetStalledUploadingFiles(batchId, { includeRetrying: false });
          }
        },
      });

      this.engine = engine;
      this.lastFileMap = fileMap;
      this.running = true;
      this.pausedByUser = false;
      this.message = null;
      this.fileRuntime = {};
      this.stopRetryCountdown();
      this.logUpload("engine_start", { batchId, files: fileMap.size, onlyFileIds });
      this.emit();

      await this.persistManifest(currentBatch, fileMap);
      await this.resetStalledUploadingFiles(batchId, { includeRetrying: true });
      this.startStallWatchdog();
      this.startBatchWatchdog();
      this.startAdaptiveMonitor();
      this.startNearCompleteWatchdog(batchId);
      cleanupStaleTusEntries({ keepBatchId: batchId, maxAgeHours: 24 });
      setActiveUploadBatchId(batchId);
      resetProgressGuardForBatch(batchId);
      resetUploadBatchStatsMonotonic(batchId);

      await engine.run({
        batch: currentBatch,
        fileMap,
        onlyFileIds,
        workerId: this.workerId ?? undefined,
      });
    } catch (error) {
      this.logUpload("engine_crash", {
        batchId,
        error: error instanceof Error ? error.message : String(error),
      });
      this.setUserMessage(error, "Erro durante upload");
    } finally {
      this.stopStallWatchdog();
      this.stopAdaptiveMonitor();
      this.stopNearCompleteWatchdog();
      this.running = false;
      this.engineStarting = false;
      this.autoRecoveryInProgress.delete(batchId);
      this.emit();
    }
    if (!this.pausedByUser && !this.cancelledBatchIds.has(batchId)) {
      await this.tryAutoRetryAfterRun(batchId, fileMap);
      await this.autoContinuePendingIfNeeded(batchId, fileMap, "engine_finished");
    }
  }

  handleFileSelection(selected: FileList | null) {
    if (!selected?.length) return;
    const files = Array.from(selected);
    const existingCount =
      this.batch?.upload_files?.filter((file) => !file.removed).length ?? 0;
    if (existingCount + files.length > MAX_VIDEOS_PER_BATCH) {
      this.message = `Limite de ${MAX_VIDEOS_PER_BATCH} vídeos por lote. Você já tem ${existingCount} e tentou adicionar ${files.length}.`;
      this.validationPreview = null;
      this.emit();
      return;
    }
    const existingNameSizes = new Set(
      (this.batch?.upload_files ?? [])
        .filter((file) => !file.removed)
        .map((file) => `${file.filename}|${file.file_size}`),
    );
    const validation = validateFiles(files, new Set(), this.maxUploadBytes, existingNameSizes);
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
    const existingNameSizes = new Set(
      (this.batch?.upload_files ?? [])
        .filter((file) => !file.removed)
        .map((file) => `${file.filename}|${file.file_size}`),
    );
    const validation = validateFiles(files, existingHashes, this.maxUploadBytes, existingNameSizes);
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

    const totalInBatch =
      (this.batch?.upload_files?.filter((f) => !f.removed).length ?? 0) + toUpload.length;
    if (totalInBatch > MAX_VIDEOS_PER_BATCH) {
      this.message = `Limite de ${MAX_VIDEOS_PER_BATCH} vídeos por lote.`;
      this.emit();
      return;
    }
    const warning = largeBatchAdaptiveMessage(totalInBatch) ?? largeBatchWarning(totalInBatch);
    if (warning) {
      this.message = warning;
    }

    this.emit();

    try {
      let currentBatch = this.batch;

      if (!currentBatch) {
        const { batch: created, resumed } = await createUploadBatch({
          accountId: config.accountId,
          platform: config.platform,
          scheduleMode: config.scheduleMode,
          customSchedule: config.customSchedule,
          uploadSpeedMode: this.speedMode,
          files: toUpload,
        });
        currentBatch = created;
        cleanupStaleTusEntries({ keepBatchId: currentBatch.id, maxAgeHours: 24 });
        this.syncBatch(currentBatch);
        if (resumed) {
          this.message =
            "Retomamos o upload anterior desta conta e adicionamos os novos vídeos ao mesmo lote.";
        }

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
        const existingCount = (currentBatch.upload_files ?? []).filter((f) => !f.removed).length;
        if (existingCount === 0 && toUpload.length > 0) {
          currentBatch = await appendFilesToUploadBatch(currentBatch, toUpload);
        } else {
          currentBatch = await ensureBatchWithFiles(currentBatch);
        }
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
      this.syncBatch(refreshed);
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
    if (this.batch && this.batch.status !== "ready" && this.batch.status !== "cancelled") {
      await this.reconcileBatchFromServer(this.batch.id);
    }
    await this.reconcileActiveBatch("foreground");
  }

  /** Polling de segurança — reconcilia estado local com o backend (endpoint leve). */
  async reconcileActiveBatch(source: "foreground" | "polling" = "polling") {
    if (this.reconcilePolling) return;
    if (!this.batch) return;
    if (!validateBatchProgressEvent(this.batch.id)) return;
    if (this.batch.status === "ready" || this.batch.status === "cancelled") {
      this.stopPolling();
      return;
    }

    this.reconcilePolling = true;
    const prevBatch = this.batch;
    const prevProgressMap = this.progressMap;

    try {
      this.serverReconcileTick += 1;
      const shouldServerReconcile =
        source === "foreground" ||
        this.batchStalled ||
        this.serverReconcileTick % 4 === 0;
      if (shouldServerReconcile) {
        await this.reconcileBatchFromServer(this.batch.id);
      }

      const remote = await fetchUploadBatchStatus(this.batch.id);
      const reconciled = reconcileUploadBatchState(this.batch, remote, this.progressMap);

      let dbBytesTotal = 0;
      for (const file of reconciled.batch.upload_files ?? []) {
        dbBytesTotal += Number(file.bytes_uploaded ?? 0);
        if (file.status === "completed") {
          this.clearFileRuntime(file.id);
        }
      }

      const sessionBytes = this.progress?.bytesUploaded ?? 0;
      const bytesMoved = dbBytesTotal > this.lastProgressBytes || sessionBytes > this.lastProgressBytes;
      if (bytesMoved) {
        this.touchProgress(Math.max(dbBytesTotal, sessionBytes));
      }

      if (remote.paused && !this.running) {
        this.pausedByUser = true;
      }

      const batchFinished =
        isTerminalRemoteBatchStatus(remote.status) || reconciled.batch.status === "ready";

      if (batchFinished && prevBatch.status !== "ready") {
        this.running = false;
        this.retrying = false;
        this.stopRetryCountdown();
        this.fileRuntime = {};
        if (remote.status === "completed") {
          this.message = null;
        } else if (remote.status === "partial_failed") {
          this.message = `${remote.failed} vídeo(s) falharam. ${remote.completed} prontos para agendar.`;
        } else if (remote.status === "failed") {
          this.message = "Não foi possível enviar os vídeos. Você pode tentar reenviar apenas os arquivos com erro.";
        }
        this.stopPolling();
        this.stopAdaptiveMonitor();
        const mergedProgressMap = { ...reconciled.progressMap };
        for (const [fileId, localPercent] of Object.entries(this.progressMap)) {
          if (!validateFileProgressEvent(this.batch?.id, fileId)) continue;
          mergedProgressMap[fileId] = applyMonotonicFilePercent(
            this.batch!.id,
            fileId,
            Math.max(localPercent ?? 0, mergedProgressMap[fileId] ?? 0),
            { source: "reconcile_merge" },
          );
        }
        this.progressMap = mergedProgressMap;
        this.syncBatch(reconciled.batch);
        this.emit();
      }

      const progressMeaningfullyChanged = Object.keys(reconciled.progressMap).some((fileId) => {
        const prev = prevProgressMap[fileId] ?? 0;
        const next = reconciled.progressMap[fileId] ?? 0;
        return Math.abs(next - prev) >= 1;
      });

      for (const fileId of Object.keys(reconciled.progressMap)) {
        const prev = prevProgressMap[fileId] ?? 0;
        const remote = reconciled.progressMap[fileId] ?? 0;
        if (remote < prev && prev >= 5) {
          const file = this.batch?.upload_files?.find((f) => f.id === fileId);
          reportClientOperationalError({
            errorType: "upload_progress_regression",
            title: "Progresso de upload voltou para trás",
            message: `${file?.filename ?? "Arquivo"}: estava em ${prev}% e caiu para ${remote}%.`,
            technicalMessage: `reconcile aplicou progresso menor (local=${prev}, remoto=${remote})`,
            probableCause:
              "Estado local inconsistente, snapshot antigo ou polling aplicando dado atrasado.",
            recommendedAction: "O sistema já impede regressão; se persistir, reconcilie o lote.",
            uploadBatchId: this.batch?.id,
            uploadFileId: fileId,
            accountId:
              this.batch?.platform === "tiktok"
                ? (this.batch.tiktok_account_id ?? undefined)
                : (this.batch?.account_id ?? undefined),
            platform: this.batch?.platform,
            metadata: { previousPercent: prev, remotePercent: remote },
          });
        }
      }

      const stateChanged =
        reconciled.changedFiles > 0 ||
        reconciled.batchStatusChanged ||
        progressMeaningfullyChanged;

      logUploadEvent("[upload-reconcile]", source, {
        batchId: remote.batchId,
        changedFiles: reconciled.changedFiles,
        batchStatusChanged: reconciled.batchStatusChanged,
        localStatus: reconciled.localStatusSummary,
        remoteStatus: reconciled.remoteStatusSummary,
        stateChanged,
        running: this.running,
        retrying: this.retrying,
        hidden: typeof document !== "undefined" ? document.hidden : false,
        pollingIntervalMs: this.getPollingIntervalMs(),
      });

      if (!batchFinished && stateChanged) {
        const mergedProgressMap = { ...reconciled.progressMap };
        for (const [fileId, localPercent] of Object.entries(this.progressMap)) {
          if (!validateFileProgressEvent(this.batch?.id, fileId)) continue;
          mergedProgressMap[fileId] = applyMonotonicFilePercent(
            this.batch!.id,
            fileId,
            Math.max(localPercent ?? 0, mergedProgressMap[fileId] ?? 0),
            { source: "reconcile_merge" },
          );
        }
        this.progressMap = mergedProgressMap;
        this.syncBatch(reconciled.batch);
      } else {
        this.ensurePolling();
      }

      if (
        reconciled.batch.status !== "ready" &&
        !this.running &&
        !this.retrying &&
        !this.engineStarting &&
        !this.recoveringFromStall &&
        !this.uploadPausedByFailures &&
        !this.pausedByUser &&
        this.lastFileMap.size > 0 &&
        this.hasPendingInSession()
      ) {
        await this.autoContinuePendingIfNeeded(reconciled.batch.id, this.lastFileMap, source);
        return;
      }

      if (
        reconciled.batch.status !== "ready" &&
        this.needsFileReselection() &&
        !this.message?.includes("Selecione novamente")
      ) {
        this.message =
          "Selecione novamente os vídeos no computador para continuar o envio.";
        this.emit();
      }
    } catch (error) {
      logUploadEvent("[upload-reconcile]", "error", {
        batchId: this.batch?.id,
        source,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.reconcilePolling = false;
    }
  }

  async retryAllFailedFiles() {
    if (!this.batch) return;

    const failed =
      this.batch.upload_files?.filter((file) => !file.removed && file.status === "failed") ?? [];
    if (!failed.length) {
      this.message = "Nenhum arquivo com erro para reenviar.";
      this.emit();
      return;
    }

    if (this.running || this.engineStarting) {
      this.message = "Aguarde o upload atual terminar antes de reenviar arquivos com erro.";
      this.emit();
      return;
    }

    const failedInSession = failed.filter((file) => this.lastFileMap.has(file.id));
    if (!failedInSession.length) {
      this.message =
        "Não foi possível continuar estes vídeos. Selecione novamente os arquivos com erro.";
      this.emit();
      this.fileInputs?.pickResume();
      return;
    }

    this.resuming = true;
    this.message = `Reenviando ${failedInSession.length} arquivo(s) com erro…`;
    this.emit();

    try {
      let refreshed = this.batch;
      for (const file of failedInSession) {
        refreshed = await resetFailedUploadFile(refreshed, file.id);
        const nextMap = { ...this.progressMap };
        delete nextMap[file.id];
        this.progressMap = nextMap;
      }

      this.syncBatch(refreshed);
      this.pausedByUser = false;
      await setBatchPaused(refreshed.id, false);
      const failedIds = failedInSession.map((file) => file.id);
      await this.startEngine(refreshed, this.lastFileMap, failedIds);
    } catch (error) {
      this.message = error instanceof Error ? error.message : "Erro ao reenviar arquivos com erro";
      this.running = false;
    } finally {
      this.resuming = false;
      this.emit();
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

  /** Limpa a sessão local para um novo lote, mantendo conta/plataforma. */
  async startNewBatch() {
    const previousBatchId = this.batch?.id;
    const config = this.config;

    if (previousBatchId) {
      await cancelUploadBatch(previousBatchId).catch(() => undefined);
      this.cancelledBatchIds.add(previousBatchId);
      resetUploadBatchStatsMonotonic(previousBatchId);
      resetProgressGuardForBatch(previousBatchId);
    } else if (config?.accountId) {
      const orphan = await fetchActiveBatch({
        summary: true,
        platform: config.platform ?? "instagram",
        accountId: config.accountId,
      }).catch(() => null);
      if (orphan?.status === "uploading") {
        await cancelUploadBatch(orphan.id).catch(() => undefined);
      }
    }
    this.engine?.abortAll();
    this.teardownUploadSessionTimers();
    this.engine = null;
    this.lastFileMap = new Map();
    this.batch = null;
    this.progress = null;
    this.progressMap = {};
    this.running = false;
    this.pausedByUser = false;
    this.retrying = false;
    this.resuming = false;
    this.message = null;
    this.validationPreview = null;
    this.batchHealthMessage = null;
    this.fileRuntime = {};
    this.autoRetryPass = 0;
    cleanupStaleTusEntries({ keepBatchId: null, maxAgeHours: 24 });
    setActiveUploadBatchId(null);
    for (const listener of this.batchListeners) listener(null);
    this.emit();
  }

  async cancelBatch() {
    if (!this.batch) return;
    if (!window.confirm("Cancelar este lote? Os vídeos já enviados serão descartados deste lote.")) {
      return;
    }

    this.cancelledBatchIds.add(this.batch.id);
    const cancelledBatchId = this.batch.id;
    this.engine?.stop();
    try {
      await cancelUploadBatch(this.batch.id);
      await clearManifestBatch(this.batch.id);
      resetUploadBatchStatsMonotonic(cancelledBatchId);
      this.batch = null;
      this.progress = null;
      this.progressMap = {};
      this.running = false;
      this.pausedByUser = false;
      this.retrying = false;
      this.message = "Lote cancelado.";
      for (const listener of this.batchListeners) listener(null);
      this.stopPolling();
    } catch (error) {
      this.message = error instanceof Error ? error.message : "Erro ao cancelar lote";
    }
    this.emit();
  }

  async clearAccountVideos(accountLabel = "conta") {
    const config = this.config;
    if (!config?.accountId) {
      this.message = "Selecione uma conta antes de apagar.";
      this.emit();
      return;
    }

    if (this.running) {
      this.message = "Aguarde o upload terminar ou pause antes de apagar os vídeos.";
      this.emit();
      return;
    }

    const platform = config.platform ?? "instagram";
    if (
      !window.confirm(
        `Apagar todos os vídeos enviados de @${accountLabel}?\n\nIsso remove os arquivos do banco e do storage desta conta. Outras contas não serão afetadas.`,
      )
    ) {
      return;
    }

    try {
      if (this.batch?.id) {
        this.cancelledBatchIds.add(this.batch.id);
        await clearManifestBatch(this.batch.id);
      }

      const result = await clearAccountUploadedVideosClient({
        platform,
        accountId: config.accountId,
      });

      this.engine?.stop();
      this.batch = null;
      this.progress = null;
      this.progressMap = {};
      this.running = false;
      this.pausedByUser = false;
      this.retrying = false;
      this.validationPreview = null;
      this.message = result.message;
      for (const listener of this.batchListeners) listener(null);
      this.stopPolling();
    } catch (error) {
      this.message = error instanceof Error ? error.message : "Erro ao apagar vídeos enviados";
    }
    this.emit();
  }

  async clearAccountBatches(accountLabel = "conta") {
    const config = this.config;
    if (!config?.accountId) {
      this.message = "Selecione uma conta antes de apagar.";
      this.emit();
      return;
    }

    if (this.running) {
      this.message = "Aguarde o upload terminar ou pause antes de apagar os lotes.";
      this.emit();
      return;
    }

    const platform = config.platform ?? "instagram";
    if (
      !window.confirm(
        `Apagar todos os lotes de upload de @${accountLabel}?\n\nIsso remove o histórico de lotes desta conta do banco de dados. Os posts já agendados no calendário não serão afetados. Outras contas não serão alteradas.`,
      )
    ) {
      return;
    }

    try {
      if (this.batch?.id) {
        this.cancelledBatchIds.add(this.batch.id);
        await clearManifestBatch(this.batch.id);
      }

      const result = await deleteAccountUploadBatchesClient({
        platform,
        accountId: config.accountId,
      });

      this.engine?.stop();
      this.batch = null;
      this.progress = null;
      this.progressMap = {};
      this.running = false;
      this.pausedByUser = false;
      this.retrying = false;
      this.validationPreview = null;
      this.message = result.message;
      for (const listener of this.batchListeners) listener(null);
      this.stopPolling();
    } catch (error) {
      this.message = error instanceof Error ? error.message : "Erro ao apagar lotes";
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
