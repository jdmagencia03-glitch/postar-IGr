import type { UploadBatchFile, UploadSpeedMode } from "@/lib/types";
import type { UploadConcurrencyConfig } from "@/lib/upload/storage-config";
import { clampUploadConcurrency } from "@/lib/upload/storage-config";

export type AdaptiveEffectiveMode = "turbo" | "normal" | "economy";
export type AdaptiveStabilityStatus =
  | "stable"
  | "unstable"
  | "degraded"
  | "safe_mode"
  | "paused";

export const ADAPTIVE_RETRY_WINDOW_MS = 120_000;
export const ADAPTIVE_STABLE_WINDOW_MS = 5 * 60_000;
export const ADAPTIVE_NO_COMPLETION_MS = 180_000;
export const LARGE_BATCH_TURBO_CONFIRM = 300;
const ADAPTIVE_MIN_FAILED_TO_REDUCE = 12;
const ADAPTIVE_MIN_RETRY_TO_REDUCE = 12;
const ADAPTIVE_MIN_STALLED_TO_REDUCE = 4;

const MODE_ORDER: AdaptiveEffectiveMode[] = ["turbo", "normal", "economy"];

export function initialAdaptiveEffectiveMode(fileCount: number): AdaptiveEffectiveMode {
  if (fileCount <= 50) return "turbo";
  return "normal";
}

export function defaultSpeedModeForBatch(fileCount: number): UploadSpeedMode {
  if (fileCount > 150) return "adaptive";
  return "normal";
}

export function recommendSpeedModeForBatch(fileCount: number): UploadSpeedMode {
  if (fileCount <= 50) return "turbo";
  if (fileCount <= 150) return "normal";
  return "adaptive";
}

export function largeBatchAdaptiveMessage(fileCount: number): string | null {
  if (fileCount <= 150) return null;
  return "Lote grande detectado. Para maior estabilidade, recomendamos o modo Adaptativo.";
}

export function turboLargeBatchConfirmMessage(fileCount: number): string {
  return `Este lote tem ${fileCount} vídeos. O modo Turbo pode causar instabilidade após centenas de envios. Recomendamos Adaptativo ou Normal. Deseja continuar com Turbo mesmo assim?`;
}

export type BatchAdaptiveMetrics = {
  total: number;
  completed: number;
  failed: number;
  pending: number;
  uploading: number;
  retrying: number;
  stalled: number;
  recentRetryCount?: number;
  speedBps30s?: number;
  speedBps2m?: number;
  hasActiveProgress?: boolean;
  lastProgressAt?: number | null;
  lastCompletionAt?: number | null;
  currentEffectiveMode: AdaptiveEffectiveMode;
  safeMode: boolean;
  userSelectedMode: UploadSpeedMode;
};

export type AdaptiveEvaluation = {
  stability: AdaptiveStabilityStatus;
  effectiveMode: AdaptiveEffectiveMode;
  targetConcurrency: number;
  recommendedMode: UploadSpeedMode;
  errorRate: number;
  retryRate: number;
  isDegraded: boolean;
  isStalled: boolean;
  shouldReduce: boolean;
  shouldEnterSafeMode: boolean;
  shouldPauseUploads: boolean;
  shouldAlertLight: boolean;
  shouldSuggestRecover: boolean;
  userMessage: string | null;
  actionMessage: string | null;
  reason: string | null;
  canSuggestSpeedIncrease: boolean;
};

function modeConcurrency(
  mode: AdaptiveEffectiveMode,
  config: UploadConcurrencyConfig,
): number {
  return clampUploadConcurrency(config[mode]);
}

function reduceMode(mode: AdaptiveEffectiveMode): AdaptiveEffectiveMode {
  const idx = MODE_ORDER.indexOf(mode);
  return idx >= MODE_ORDER.length - 1 ? "economy" : MODE_ORDER[idx + 1]!;
}

function modeLabel(mode: AdaptiveEffectiveMode) {
  if (mode === "turbo") return "Turbo";
  if (mode === "normal") return "Normal";
  return "Econômico";
}

export function countBatchFileStatuses(files: UploadBatchFile[]) {
  let completed = 0;
  let failed = 0;
  let pending = 0;
  let uploading = 0;
  let retrying = 0;
  let stalled = 0;

  for (const file of files) {
    if (file.removed) continue;
    switch (file.status) {
      case "completed":
        completed += 1;
        break;
      case "failed":
        failed += 1;
        break;
      case "uploading":
        uploading += 1;
        break;
      case "retrying":
        retrying += 1;
        break;
      case "stalled":
        stalled += 1;
        break;
      default:
        pending += 1;
    }
  }

  const total = completed + failed + pending + uploading + retrying + stalled;
  return { total, completed, failed, pending, uploading, retrying, stalled };
}

export function evaluateAdaptiveUpload(
  metrics: BatchAdaptiveMetrics,
  concurrency: UploadConcurrencyConfig,
): AdaptiveEvaluation {
  const {
    total,
    completed,
    failed,
    pending,
    uploading,
    retrying,
    stalled,
    recentRetryCount = 0,
    speedBps30s = 0,
    speedBps2m = 0,
    hasActiveProgress = false,
    lastProgressAt,
    lastCompletionAt,
    currentEffectiveMode,
    safeMode,
    userSelectedMode,
  } = metrics;

  const errorRate = total > 0 ? failed / total : 0;
  const retryRate = total > 0 ? (retrying + stalled) / total : 0;
  const now = Date.now();
  const progressIdleMs =
    lastProgressAt != null ? now - lastProgressAt : Number.POSITIVE_INFINITY;
  const completionIdleMs =
    lastCompletionAt != null ? now - lastCompletionAt : Number.POSITIVE_INFINITY;
  const hasPendingWork = pending + uploading + retrying + stalled > 0;

  const speedDropping =
    speedBps2m > 0 && speedBps30s > 0 && speedBps30s < speedBps2m * 0.4 && hasActiveProgress;
  const noRealProgress =
    hasPendingWork &&
    !hasActiveProgress &&
    progressIdleMs >= ADAPTIVE_NO_COMPLETION_MS &&
    completionIdleMs >= ADAPTIVE_NO_COMPLETION_MS;

  // Nunca pausar o lote inteiro por falhas — o motor já ignora arquivos failed.
  const shouldPauseUploads = false;
  const shouldSuggestRecover = failed >= 30 || (errorRate >= 0.08 && failed >= 10);
  const shouldEnterSafeMode =
    safeMode || (total >= 150 ? errorRate >= 0.15 && failed >= 20 : failed >= 20);
  const shouldAlertLight = failed >= 5 && failed < 10 && errorRate < 0.05;
  const shouldReduce =
    stalled >= ADAPTIVE_MIN_STALLED_TO_REDUCE ||
    recentRetryCount >= ADAPTIVE_MIN_RETRY_TO_REDUCE ||
    (failed >= ADAPTIVE_MIN_FAILED_TO_REDUCE && errorRate > 0.1) ||
    (failed >= 20 && errorRate > 0.06) ||
    noRealProgress ||
    (speedDropping && failed >= 10) ||
    (uploading > 0 && !hasActiveProgress && progressIdleMs >= 120_000);

  let effectiveMode = currentEffectiveMode;
  let stability: AdaptiveStabilityStatus = "stable";
  let userMessage: string | null = null;
  let actionMessage: string | null = null;
  let reason: string | null = null;

  if (shouldPauseUploads) {
    stability = "paused";
    effectiveMode = "economy";
    userMessage =
      "Muitos arquivos estão falhando. Use Recuperar upload ou tente novamente os falhados.";
    reason = `${failed} falhas no lote`;
  } else if (shouldEnterSafeMode) {
    stability = "safe_mode";
    effectiveMode = "economy";
    userMessage =
      "Taxa de erro elevada. Reduzimos a velocidade — os vídeos pendentes continuam em segundo plano.";
    actionMessage = `Concorrência limitada a ${modeConcurrency("economy", concurrency)} simultâneos.`;
    reason = `${failed} falhas (${Math.round(errorRate * 100)}% do lote)`;
  } else if (shouldReduce) {
    stability = "unstable";
    const previous = effectiveMode;
    effectiveMode = reduceMode(effectiveMode);
    if (previous !== effectiveMode) {
      actionMessage = `${modeLabel(previous)} pausado temporariamente. Continuando em modo ${modeLabel(effectiveMode)}.`;
    }
    userMessage = "Upload instável detectado. Reduzindo velocidade para evitar falhas.";
    if (stalled >= 3) reason = `${stalled} arquivos travados`;
    else if (recentRetryCount >= 5) reason = `${recentRetryCount} retries recentes`;
    else if (errorRate > 0.05) reason = `taxa de erro ${Math.round(errorRate * 100)}%`;
    else if (failed >= 10) reason = `${failed} falhas no lote`;
    else if (noRealProgress) reason = "sem progresso real";
    else if (speedDropping) reason = "velocidade caindo";
    else reason = "uploads sem progresso";
  } else if (shouldSuggestRecover) {
    stability = "degraded";
    userMessage = `${failed} vídeo(s) com erro (${Math.round(errorRate * 100)}%). O lote continua — falhas não bloqueiam os pendentes.`;
    reason = `${failed} falhas`;
  } else if (shouldAlertLight) {
    stability = "degraded";
    userMessage = `${failed} vídeo(s) com erro até agora. Monitorando estabilidade do lote.`;
    reason = "falhas iniciais";
  }

  const isDegraded =
    stability !== "stable" || failed >= 5 || stalled >= 2 || errorRate > 0.03;
  const isStalled = noRealProgress || stalled >= 3;

  const recommendedMode = recommendSpeedModeForBatch(total);

  const stableLongEnough =
    progressIdleMs < 60_000 &&
    completionIdleMs < ADAPTIVE_STABLE_WINDOW_MS &&
    failed < 5 &&
    errorRate < 0.02 &&
    !shouldReduce;
  const canSuggestSpeedIncrease =
    stableLongEnough &&
    effectiveMode === "economy" &&
    total > 50 &&
    userSelectedMode === "adaptive";

  if (canSuggestSpeedIncrease && !userMessage) {
    userMessage = "Upload estável há alguns minutos. Você pode voltar para Normal se quiser.";
  }

  return {
    stability,
    effectiveMode,
    targetConcurrency: modeConcurrency(effectiveMode, concurrency),
    recommendedMode,
    errorRate,
    retryRate,
    isDegraded,
    isStalled,
    shouldReduce: shouldReduce && !shouldEnterSafeMode && !shouldPauseUploads,
    shouldEnterSafeMode,
    shouldPauseUploads,
    shouldAlertLight,
    shouldSuggestRecover,
    userMessage,
    actionMessage,
    reason,
    canSuggestSpeedIncrease,
  };
}

export function getAdaptiveSpeedPreset(
  effectiveMode: AdaptiveEffectiveMode,
  concurrency: UploadConcurrencyConfig,
) {
  const fileConcurrency = modeConcurrency(effectiveMode, concurrency);
  return {
    label: "Adaptativo",
    fileConcurrency,
    effectiveLabel: modeLabel(effectiveMode),
    description: `Ajusta automaticamente · ${fileConcurrency} simultâneos (${modeLabel(effectiveMode)})`,
  };
}

export type SpeedDisplayState = {
  speedBps: number;
  speedBps30s: number;
  speedBps2m: number;
  etaSeconds: number;
  speedLabel: "normal" | "calculating" | "no_progress";
  etaLabel: string;
};

export function buildSpeedDisplay(params: {
  speedBps30s: number;
  speedBps2m: number;
  etaSeconds: number;
  hasActiveUploads: boolean;
  hasByteProgress: boolean;
}): SpeedDisplayState {
  const { speedBps30s, speedBps2m, etaSeconds, hasActiveUploads, hasByteProgress } = params;

  let speedLabel: SpeedDisplayState["speedLabel"] = "normal";
  let speedBps = speedBps30s > 0 ? speedBps30s : speedBps2m;

  if (hasActiveUploads && !hasByteProgress) {
    speedLabel = "no_progress";
    speedBps = 0;
  } else if (speedBps <= 0 && hasActiveUploads) {
    speedLabel = "calculating";
    speedBps = 0;
  }

  let etaLabel = "—";
  if (speedLabel === "no_progress") {
    etaLabel = "sem progresso detectado";
  } else if (speedLabel === "calculating") {
    etaLabel = "calculando…";
  } else if (speedBps > 0 && Number.isFinite(etaSeconds) && etaSeconds > 0) {
    etaLabel = formatEtaSeconds(etaSeconds);
  }

  return {
    speedBps,
    speedBps30s,
    speedBps2m,
    etaSeconds: speedLabel === "normal" ? etaSeconds : 0,
    speedLabel,
    etaLabel,
  };
}

function formatEtaSeconds(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "—";
  if (seconds < 60) return `${Math.ceil(seconds)}s`;
  if (seconds < 3600) return `${Math.ceil(seconds / 60)} min`;
  const h = Math.floor(seconds / 3600);
  const m = Math.ceil((seconds % 3600) / 60);
  return m > 0 ? `${h}h ${m}min` : `${h}h`;
}
