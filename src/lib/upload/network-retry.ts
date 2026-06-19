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

export function userMessageForUploadError(classification: UploadErrorClassification) {
  switch (classification.kind) {
    case "network":
      return "Conexão instável. Tentando novamente…";
    case "server":
      return "Servidor temporariamente indisponível. Tentando novamente…";
    case "rate_limit":
      return "Servidor ocupado. Tentando novamente em instantes…";
    case "auth":
      return "Não foi possível enviar este vídeo por falta de permissão. Faça login novamente.";
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
  const seconds = Math.max(1, Math.round(params.delayMs / 1000));
  if (params.kind === "server") {
    return `Servidor instável. Tentativa ${params.attempt} de ${params.maxAttempts} em ${seconds}s…`;
  }
  return `Conexão instável. Tentativa ${params.attempt} de ${params.maxAttempts} em ${seconds}s…`;
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
    | "[upload-polling]",
  event: string,
  detail?: Record<string, unknown>,
) {
  if (typeof console === "undefined") return;
  console.info(`${prefix} ${event}`, {
    timestamp: new Date().toISOString(),
    ...detail,
  });
}
