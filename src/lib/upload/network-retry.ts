import {
  classifyConnectionState,
  uploadRetryMessage,
  userMessageForState,
} from "@/lib/connection-state";
import { extractUploadErrorMessage } from "@/lib/upload/errors";

/** Backoff entre tentativas de upload por arquivo (ms). */
export const UPLOAD_FILE_RETRY_DELAYS_MS = [5_000, 15_000, 30_000, 60_000, 120_000] as const;

export const UPLOAD_FILE_MAX_ATTEMPTS = UPLOAD_FILE_RETRY_DELAYS_MS.length + 1;

type TusLikeError = Error & {
  originalResponse?: {
    getStatus?: () => number;
  };
};

export type UploadErrorKind =
  | "network"
  | "server"
  | "rate_limit"
  | "auth"
  | "file"
  | "stall"
  | "unknown";

export interface UploadErrorClassification {
  kind: UploadErrorKind;
  recoverable: boolean;
  message: string;
  statusCode?: number;
}

function errorStatus(error: unknown): number | undefined {
  if (!(error instanceof Error)) return undefined;
  return (error as TusLikeError).originalResponse?.getStatus?.();
}

export function classifyUploadError(error: unknown): UploadErrorClassification {
  const message = extractUploadErrorMessage(error);
  const lower = message.toLowerCase();
  const statusCode = errorStatus(error);

  if (
    statusCode === 401 ||
    statusCode === 403 ||
    /unauthorized|forbidden|permission|jwt|token|expired|login/i.test(lower)
  ) {
    return {
      kind: "auth",
      recoverable: false,
      message,
      statusCode,
    };
  }

  if (
    /413|payload too large|too large|file_size_limit|exceeded the maximum|formato|format|invalid file|mime/i.test(
      lower,
    )
  ) {
    return {
      kind: "file",
      recoverable: false,
      message,
      statusCode,
    };
  }

  if (
    statusCode === 408 ||
    statusCode === 429 ||
    statusCode === 500 ||
    statusCode === 502 ||
    statusCode === 503 ||
    statusCode === 504 ||
    /429|rate limit|too many requests|muitas requisições/i.test(lower)
  ) {
    return {
      kind: statusCode === 429 ? "rate_limit" : "server",
      recoverable: true,
      message,
      statusCode,
    };
  }

  if (
    /upload_stall|sem progresso|reconectando automaticamente|stall_timeout|upload travado|tempo máximo de upload/i.test(
      lower,
    )
  ) {
    return {
      kind: "stall",
      recoverable: true,
      message,
      statusCode,
    };
  }

  if (
    /network|failed to fetch|timeout|aborted|offline|connection|econnreset|etimedout|err_network|fetch failed|load failed|socket/i.test(
      lower,
    )
  ) {
    return {
      kind: "network",
      recoverable: true,
      message,
      statusCode,
    };
  }

  return {
    kind: "unknown",
    recoverable: false,
    message,
    statusCode,
  };
}

function connectionKindForUpload(classification: UploadErrorClassification) {
  if (classification.kind === "stall") {
    return classifyConnectionState({ source: "upload_stall" });
  }
  return classifyConnectionState({
    source: "error",
    error: new Error(classification.message),
    httpStatus: classification.statusCode,
  });
}

export function userMessageForUploadError(classification: UploadErrorClassification) {
  const stateKind = connectionKindForUpload(classification);
  switch (classification.kind) {
    case "stall":
      return userMessageForState("upload_stalled");
    case "network":
      return userMessageForState(
        stateKind === "offline" ? "offline" : "unknown",
        { consecutiveFailures: 1 },
      );
    case "server":
      return userMessageForState("server_error");
    case "rate_limit":
      return userMessageForState("rate_limited");
    case "auth":
      return userMessageForState("auth_error");
    case "file":
      return "Este arquivo não pôde ser enviado. Verifique formato e tamanho.";
    default:
      return classification.message || "Erro ao enviar vídeo.";
  }
}

export function retryMessage(params: {
  attempt: number;
  maxAttempts: number;
  delayMs: number;
  kind: UploadErrorKind;
}) {
  const stateKind =
    params.kind === "stall"
      ? classifyConnectionState({ source: "upload_stall" })
      : params.kind === "server" || params.kind === "rate_limit"
        ? classifyConnectionState({
            source: "http",
            status: params.kind === "rate_limit" ? 429 : 503,
          })
        : params.kind === "network"
          ? classifyConnectionState({
              source: "error",
              error: new Error("failed to fetch"),
            })
          : classifyConnectionState({ source: "error", error: new Error("unknown") });

  return uploadRetryMessage(stateKind, params);
}

export function logUploadEvent(
  prefix:
    | "[upload-network]"
    | "[upload-retry]"
    | "[upload-watchdog]"
    | "[upload-stalled]"
    | "[upload-recovered]"
    | "[upload-failed]"
    | "[upload-ui-state]"
    | "[upload-store-emit]"
    | "[upload-engine-event]"
    | "[upload-reconcile]"
    | "[upload-polling]"
    | "[upload-snapshot]"
    | "[upload-stats-reconcile]",
  event: string,
  detail?: Record<string, unknown>,
) {
  if (typeof console === "undefined") return;

  const debugOnly =
    prefix === "[upload-store-emit]" ||
    prefix === "[upload-snapshot]" ||
    prefix === "[upload-reconcile]" ||
    prefix === "[upload-polling]" ||
    prefix === "[upload-stats-reconcile]" ||
    (prefix === "[upload-engine-event]" && event !== "upload_error");

  if (debugOnly) {
    if (process.env.NEXT_PUBLIC_UPLOAD_DEBUG !== "true") return;
  }

  const isError =
    event === "error" ||
    event === "upload_error" ||
    event === "file_failed" ||
    prefix === "[upload-failed]";

  if (debugOnly && !isError) return;

  console.info(`${prefix} ${event}`, {
    timestamp: new Date().toISOString(),
    ...detail,
  });
}
