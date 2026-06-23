import type { ApiErrorResult } from "@/lib/api/client";
import type { WorkerDisplayStatus } from "@/lib/schedule-jobs/state";

/** Classificação fina de falhas — não confundir com "reconectando". */
export type ConnectionStateKind =
  | "online"
  | "offline"
  | "server_error"
  | "timeout"
  | "auth_error"
  | "permission_error"
  | "rate_limited"
  | "worker_idle"
  | "worker_stuck"
  | "job_processing"
  | "upload_stalled"
  | "unknown";

export type ConnectionStatus = "online" | "offline" | "unstable" | "server_error";

export type JobStatusKind =
  | "queued"
  | "processing"
  | "saving_posts"
  | "completed"
  | "stuck"
  | "failed";

export type WorkerStatusKind =
  | "active"
  | "idle"
  | "between_cycles"
  | "stuck"
  | "failed";

export type ClassifyInput =
  | { source: "error"; error: unknown; endpoint?: string; httpStatus?: number }
  | { source: "http"; status: number; endpoint?: string }
  | { source: "api_result"; result: ApiErrorResult; endpoint?: string }
  | { source: "upload_stall" }
  | {
      source: "worker";
      workerStatus: WorkerDisplayStatus;
      jobActive?: boolean;
    };

export type ConnectionStateMeta = {
  endpoint?: string;
  httpStatus?: number;
  elapsedMs?: number;
  jobId?: string;
  uploadBatchId?: string;
  workerStatus?: string;
};

const NETWORK_ERROR_RE =
  /failed to fetch|networkerror|network error|load failed|fetch failed|err_network|err_internet_disconnected|network request failed|econnreset|etimedout|socket hang up/i;

const TIMEOUT_ERROR_RE = /abort|timeout|timed out|deadline|504|408/i;

const UPLOAD_STALL_RE =
  /upload_stall|sem progresso|stall_timeout|upload travado|tempo máximo de upload/i;

export function isBrowserOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error ?? "");
}

export function classifyConnectionState(input: ClassifyInput): ConnectionStateKind {
  if (input.source === "upload_stall") return "upload_stalled";

  if (input.source === "worker") {
    if (!input.jobActive) return "worker_idle";
    switch (input.workerStatus) {
      case "processing":
        return "job_processing";
      case "queued_next":
        return "job_processing";
      case "stalled":
        return "worker_stuck";
      default:
        return "worker_idle";
    }
  }

  if (input.source === "api_result") {
    return mapApiErrorType(input.result.type, input.result.status);
  }

  const status =
    input.source === "http"
      ? input.status
      : input.httpStatus ?? extractHttpStatus(input.error);

  if (status != null) {
    if (status === 401) return "auth_error";
    if (status === 403) return "permission_error";
    if (status === 429) return "rate_limited";
    if (status === 408 || status === 504) return "timeout";
    if (status >= 500) return "server_error";
    if (status >= 400) return "unknown";
  }

  const message =
    input.source === "error" ? errorMessage(input.error) : "";

  if (UPLOAD_STALL_RE.test(message)) return "upload_stalled";

  if (isBrowserOffline()) return "offline";

  if (TIMEOUT_ERROR_RE.test(message) && !NETWORK_ERROR_RE.test(message)) {
    return "timeout";
  }

  if (NETWORK_ERROR_RE.test(message)) {
    return isBrowserOffline() ? "offline" : "timeout";
  }

  return "unknown";
}

function mapApiErrorType(
  type: ApiErrorResult["type"],
  status?: number,
): ConnectionStateKind {
  switch (type) {
    case "network":
      return isBrowserOffline() ? "offline" : "timeout";
    case "timeout":
      return "timeout";
    case "server":
      return "server_error";
    case "auth":
      return "auth_error";
    case "permission":
      return "permission_error";
    case "validation":
      return "unknown";
    default:
      if (status === 429) return "rate_limited";
      return "unknown";
  }
}

function extractHttpStatus(error: unknown): number | undefined {
  if (!(error instanceof Error)) return undefined;
  const tus = error as Error & {
    originalResponse?: { getStatus?: () => number };
  };
  return tus.originalResponse?.getStatus?.();
}

export function isRealNetworkFailure(kind: ConnectionStateKind): boolean {
  return kind === "offline";
}

export function connectionStatusFromKind(kind: ConnectionStateKind): ConnectionStatus {
  switch (kind) {
    case "offline":
      return "offline";
    case "server_error":
    case "timeout":
      return "server_error";
    case "rate_limited":
    case "unknown":
    case "upload_stalled":
    case "worker_stuck":
      return "unstable";
    case "worker_idle":
    case "job_processing":
    case "online":
      return "online";
    default:
      return "online";
  }
}

export function workerStatusFromDisplay(status: WorkerDisplayStatus): WorkerStatusKind {
  switch (status) {
    case "processing":
      return "active";
    case "queued_next":
      return "between_cycles";
    case "stalled":
      return "stuck";
    default:
      return "idle";
  }
}

export function userMessageForState(
  kind: ConnectionStateKind,
  context?: { attempt?: number; consecutiveFailures?: number },
): string {
  const failures = context?.consecutiveFailures ?? 0;

  switch (kind) {
    case "offline":
      if (failures >= 2) return "Sua conexão caiu. Tentando reconectar…";
      return "Verificando conexão…";
    case "timeout":
      return "Sua conexão oscilou durante o envio. Vamos tentar novamente automaticamente.";
    case "server_error":
      return "O servidor encontrou um erro. Registramos o problema.";
    case "auth_error":
      return "Sua sessão expirou. Faça login novamente.";
    case "permission_error":
      return "Você não tem permissão para esta ação.";
    case "rate_limited":
      return "Muitas requisições — aguardando antes de tentar de novo.";
    case "worker_idle":
      return "Processamento em segundo plano ativo.";
    case "worker_stuck":
      return "Processador sem resposta. Tentando recuperar o job…";
    case "job_processing":
      return "Aguardando próximo ciclo de processamento…";
    case "upload_stalled":
      return "Sua conexão oscilou durante o envio. Vamos tentar novamente automaticamente.";
    case "online":
      return "Conectado";
    default:
      return failures >= 3
        ? "Não foi possível atualizar o status agora."
        : "Atualizando status…";
  }
}

export function uploadRetryMessage(kind: ConnectionStateKind, params: {
  attempt: number;
  maxAttempts: number;
  delayMs: number;
}): string {
  const seconds = Math.max(1, Math.round(params.delayMs / 1000));
  switch (kind) {
    case "upload_stalled":
      return `Upload sem progresso — tentativa ${params.attempt}/${params.maxAttempts} em ${seconds}s…`;
    case "timeout":
      return `Servidor demorou — tentativa ${params.attempt}/${params.maxAttempts} em ${seconds}s…`;
    case "server_error":
    case "rate_limited":
      return `Servidor ocupado — tentativa ${params.attempt}/${params.maxAttempts} em ${seconds}s…`;
    case "offline":
      return `Sua conexão oscilou — tentativa ${params.attempt}/${params.maxAttempts} em ${seconds}s…`;
    default:
      return `Tentando enviar novamente (${params.attempt}/${params.maxAttempts}) em ${seconds}s…`;
  }
}

export function formatUploadErrorByState(message: string): string {
  const kind = classifyConnectionState({ source: "error", error: new Error(message) });
  if (kind === "upload_stalled") {
    return userMessageForState("upload_stalled");
  }
  if (kind === "rate_limited") {
    return userMessageForState("rate_limited");
  }
  if (kind === "offline") {
    return "Tentando enviar novamente.";
  }
  if (kind === "timeout") {
    return userMessageForState("timeout");
  }
  if (kind === "server_error") {
    return "Servidor recusou o envio deste arquivo.";
  }
  return message;
}

export type PollingDisplayState = {
  showBanner: boolean;
  bannerLevel: "none" | "subtle" | "alert";
  userMessage: string | null;
  connectionStatus: ConnectionStatus;
  consecutiveFailures: number;
  kind: ConnectionStateKind;
};

export type PollingTechnicalDetails = {
  lastEndpoint: string | null;
  lastHttpStatus: number | null;
  consecutiveFailures: number;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastKind: ConnectionStateKind;
  browserOnline: boolean;
  lastElapsedMs: number | null;
};

export class PollingStateTracker {
  private consecutiveFailures = 0;
  private lastSuccessAt: number | null = null;
  private lastFailureAt: number | null = null;
  private lastEndpoint: string | null = null;
  private lastHttpStatus: number | null = null;
  private lastKind: ConnectionStateKind = "online";
  private lastDisplayMessage: string | null = null;
  private lastDisplayUpdateAt = 0;
  private lastElapsedMs: number | null = null;

  constructor(
    private readonly debounceMs = 4_000,
    private readonly warnThreshold = 2,
    private readonly alertThreshold = 3,
  ) {}

  recordSuccess(endpoint: string, elapsedMs?: number): PollingDisplayState {
    this.consecutiveFailures = 0;
    this.lastSuccessAt = Date.now();
    this.lastEndpoint = endpoint;
    this.lastKind = "online";
    this.lastElapsedMs = elapsedMs ?? null;
    this.lastDisplayMessage = null;
    return this.buildDisplay("online");
  }

  recordFailure(input: ClassifyInput, meta: ConnectionStateMeta = {}): PollingDisplayState {
    const kind = classifyConnectionState(input);
    this.consecutiveFailures += 1;
    this.lastFailureAt = Date.now();
    this.lastKind = kind;
    this.lastEndpoint = meta.endpoint ?? this.lastEndpoint;
    this.lastHttpStatus = meta.httpStatus ?? this.lastHttpStatus ?? null;
    this.lastElapsedMs = meta.elapsedMs ?? null;

    if (!isRealNetworkFailure(kind)) {
      console.info("[false-reconnect-prevented]", {
        kind,
        endpoint: meta.endpoint,
        httpStatus: meta.httpStatus,
        consecutiveFailures: this.consecutiveFailures,
        navigatorOnline: !isBrowserOffline(),
        timestamp: new Date().toISOString(),
        ...meta,
      });
    } else {
      console.warn("[connection-state]", {
        kind,
        endpoint: meta.endpoint,
        consecutiveFailures: this.consecutiveFailures,
        navigatorOnline: !isBrowserOffline(),
        timestamp: new Date().toISOString(),
        ...meta,
      });
    }

    if (kind === "timeout") {
      console.warn("[server-timeout]", {
        endpoint: meta.endpoint,
        elapsedMs: meta.elapsedMs,
        consecutiveFailures: this.consecutiveFailures,
      });
    }

    console.warn("[polling-failed]", {
      endpoint: meta.endpoint,
      kind,
      httpStatus: meta.httpStatus,
      consecutiveFailures: this.consecutiveFailures,
      jobId: meta.jobId,
      uploadBatchId: meta.uploadBatchId,
    });

    return this.buildDisplay(kind);
  }

  private buildDisplay(kind: ConnectionStateKind): PollingDisplayState {
    const now = Date.now();
    let bannerLevel: PollingDisplayState["bannerLevel"] = "none";
    let userMessage: string | null = null;

    if (kind === "online") {
      this.lastDisplayMessage = null;
    } else if (this.consecutiveFailures >= this.alertThreshold) {
      bannerLevel = "alert";
      userMessage = userMessageForState(kind, {
        consecutiveFailures: this.consecutiveFailures,
      });
    } else if (this.consecutiveFailures >= this.warnThreshold) {
      bannerLevel = "subtle";
      userMessage = userMessageForState(kind, {
        consecutiveFailures: this.consecutiveFailures,
      });
    } else if (this.consecutiveFailures === 1) {
      bannerLevel = "none";
      if (kind !== "offline") {
        userMessage = "Atualizando status…";
      }
    }

    if (userMessage && now - this.lastDisplayUpdateAt < this.debounceMs && this.lastDisplayMessage) {
      userMessage = this.lastDisplayMessage;
    } else if (userMessage) {
      this.lastDisplayMessage = userMessage;
      this.lastDisplayUpdateAt = now;
    }

    return {
      showBanner: bannerLevel !== "none" && userMessage != null,
      bannerLevel,
      userMessage,
      connectionStatus: connectionStatusFromKind(kind),
      consecutiveFailures: this.consecutiveFailures,
      kind,
    };
  }

  getTechnicalDetails(): PollingTechnicalDetails {
    return {
      lastEndpoint: this.lastEndpoint,
      lastHttpStatus: this.lastHttpStatus,
      consecutiveFailures: this.consecutiveFailures,
      lastSuccessAt: this.lastSuccessAt ? new Date(this.lastSuccessAt).toISOString() : null,
      lastFailureAt: this.lastFailureAt ? new Date(this.lastFailureAt).toISOString() : null,
      lastKind: this.lastKind,
      browserOnline: !isBrowserOffline(),
      lastElapsedMs: this.lastElapsedMs,
    };
  }
}

/** Verifica se o servidor responde (diferencia internet local vs backend). */
export async function probeServerHealth(timeoutMs = 8_000): Promise<{
  reachable: boolean;
  kind: ConnectionStateKind;
}> {
  const started = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch("/api/health", {
      cache: "no-store",
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (res.ok) return { reachable: true, kind: "online" };
    return {
      reachable: true,
      kind: classifyConnectionState({ source: "http", status: res.status, endpoint: "/api/health" }),
    };
  } catch (error) {
    const elapsedMs = Date.now() - started;
    if (isBrowserOffline()) {
      return { reachable: false, kind: "offline" };
    }
    const kind = classifyConnectionState({
      source: "error",
      error,
      endpoint: "/api/health",
    });
    console.info("[connection-state] health probe", { kind, elapsedMs, navigatorOnline: !isBrowserOffline() });
    return { reachable: false, kind };
  }
}

export function jobBannerForWorker(
  workerStatus: WorkerDisplayStatus,
  isStalled: boolean,
): string | null {
  if (isStalled) {
    return "Agendamento sem progresso detectado.";
  }
  switch (workerStatus) {
    case "processing":
      return "Processamento em segundo plano ativo.";
    case "queued_next":
      return "Aguardando próximo ciclo automático.";
    case "stalled":
      return "Processador sem resposta. Tentando recuperar o job…";
    default:
      return null;
  }
}
