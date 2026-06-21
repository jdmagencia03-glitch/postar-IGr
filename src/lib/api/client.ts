"use client";

export type ApiErrorType =
  | "network"
  | "timeout"
  | "server"
  | "auth"
  | "permission"
  | "validation"
  | "unknown";

export type ApiErrorResult = {
  ok: false;
  type: ApiErrorType;
  status?: number;
  message: string;
  technicalMessage?: string;
  retryable: boolean;
  requestId?: string;
  code?: string;
};

export type ApiSuccessResult<T> = {
  ok: true;
  data: T;
  requestId?: string;
};

export type ApiResult<T> = ApiSuccessResult<T> | ApiErrorResult;

export type SafeFetchOptions = {
  method?: string;
  headers?: HeadersInit;
  body?: BodyInit | null;
  credentials?: RequestCredentials;
  cache?: RequestCache;
  timeoutMs?: number;
  retries?: number;
  retryBackoffMs?: number[];
  idempotencyKey?: string;
  signal?: AbortSignal;
};

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_RETRIES = 3;
const DEFAULT_BACKOFF = [2_000, 5_000, 10_000, 30_000];

const USER_MESSAGES: Record<ApiErrorType, string> = {
  network: "Sua conexão caiu. Tentando reconectar…",
  timeout: "Servidor demorou para responder. Tentando novamente…",
  server: "O servidor encontrou um erro. Registramos o problema e você pode tentar novamente.",
  auth: "Sua sessão expirou. Faça login novamente para continuar.",
  permission: "Você não tem permissão para executar esta ação.",
  validation: "Alguns dados necessários estão faltando. Verifique os detalhes e tente novamente.",
  unknown: "Não foi possível completar a ação agora. Tente novamente em instantes.",
};

function createRequestId() {
  return `REQ-${Math.random().toString(36).slice(2, 8)}`;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function classifyFetchError(error: unknown, requestId: string): ApiErrorResult {
  const technicalMessage = error instanceof Error ? error.message : String(error);

  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return {
      ok: false,
      type: "network",
      message: USER_MESSAGES.network,
      technicalMessage,
      retryable: true,
      requestId,
    };
  }

  if (/abort|timeout|timed out|deadline/i.test(technicalMessage)) {
    return {
      ok: false,
      type: "timeout",
      message: USER_MESSAGES.timeout,
      technicalMessage,
      retryable: true,
      requestId,
    };
  }

  if (/failed to fetch|networkerror|network error|load failed|fetch failed|err_network/i.test(technicalMessage)) {
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      return {
        ok: false,
        type: "network",
        message: USER_MESSAGES.network,
        technicalMessage,
        retryable: true,
        requestId,
      };
    }
    console.info("[false-reconnect-prevented]", {
      requestId,
      reason: "failed_to_fetch_while_online",
      navigatorOnline: true,
    });
    return {
      ok: false,
      type: "timeout",
      message: USER_MESSAGES.timeout,
      technicalMessage,
      retryable: true,
      requestId,
    };
  }

  return {
    ok: false,
    type: "unknown",
    message: USER_MESSAGES.unknown,
    technicalMessage,
    retryable: true,
    requestId,
  };
}

function classifyHttpError(
  status: number,
  body: Record<string, unknown>,
  requestId: string,
): ApiErrorResult {
  const serverMessage =
    (typeof body.message === "string" && body.message) ||
    (typeof body.error === "string" && body.error) ||
    undefined;
  const serverRequestId =
    (typeof body.requestId === "string" && body.requestId) ||
    (typeof body.request_id === "string" && body.request_id) ||
    requestId;
  const code = typeof body.code === "string" ? body.code : undefined;
  const retryable =
    typeof body.retryable === "boolean"
      ? body.retryable
      : status === 408 || status === 429 || status >= 500;

  if (status === 401) {
    return {
      ok: false,
      type: "auth",
      status,
      message: USER_MESSAGES.auth,
      technicalMessage: serverMessage,
      retryable: false,
      requestId: serverRequestId,
      code,
    };
  }

  if (status === 403) {
    return {
      ok: false,
      type: "permission",
      status,
      message: USER_MESSAGES.permission,
      technicalMessage: serverMessage,
      retryable: false,
      requestId: serverRequestId,
      code,
    };
  }

  if (status === 400 || status === 422) {
    return {
      ok: false,
      type: "validation",
      status,
      message: serverMessage ?? USER_MESSAGES.validation,
      technicalMessage: serverMessage,
      retryable: false,
      requestId: serverRequestId,
      code,
    };
  }

  if (status === 408 || status === 504) {
    return {
      ok: false,
      type: "timeout",
      status,
      message: USER_MESSAGES.timeout,
      technicalMessage: serverMessage,
      retryable: true,
      requestId: serverRequestId,
      code,
    };
  }

  if (status >= 500) {
    return {
      ok: false,
      type: "server",
      status,
      message: serverMessage
        ? `${serverMessage} Código: ${serverRequestId}.`
        : `${USER_MESSAGES.server} Código: ${serverRequestId}.`,
      technicalMessage: serverMessage,
      retryable,
      requestId: serverRequestId,
      code,
    };
  }

  return {
    ok: false,
    type: "unknown",
    status,
    message: serverMessage ?? USER_MESSAGES.unknown,
    technicalMessage: serverMessage,
    retryable,
    requestId: serverRequestId,
    code,
  };
}

async function parseJsonBody(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  const trimmed = text.trim();
  if (!trimmed) return {};
  if (trimmed.startsWith("<")) {
    return { message: "Resposta HTML do servidor (possível timeout ou erro de proxy)." };
  }
  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return { message: trimmed.slice(0, 200) };
  }
}

export async function safeFetch<T = Record<string, unknown>>(
  input: RequestInfo | URL,
  options: SafeFetchOptions = {},
): Promise<ApiResult<T>> {
  const requestId = createRequestId();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRetries = options.retries ?? DEFAULT_RETRIES;
  const backoff = options.retryBackoffMs ?? DEFAULT_BACKOFF;

  const headers = new Headers(options.headers);
  headers.set("X-Request-Id", requestId);
  if (options.idempotencyKey) {
    headers.set("Idempotency-Key", options.idempotencyKey);
  }

  let lastError: ApiErrorResult | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    const started = Date.now();

    try {
      const response = await fetch(input, {
        method: options.method,
        headers,
        body: options.body,
        credentials: options.credentials ?? "include",
        cache: options.cache,
        signal: options.signal ?? controller.signal,
      });

      clearTimeout(timeout);
      const elapsedMs = Date.now() - started;
      const body = await parseJsonBody(response);

      if (response.status === 401 && typeof window !== "undefined") {
        const next = encodeURIComponent(window.location.pathname + window.location.search);
        window.location.href = `/login?next=${next}`;
      }

      if (!response.ok) {
        const err = classifyHttpError(response.status, body, requestId);
        console.warn("[api-error]", {
          requestId: err.requestId,
          url: String(input),
          method: options.method ?? "GET",
          status: response.status,
          type: err.type,
          elapsedMs,
          attempt,
          message: err.technicalMessage,
        });

        if (!err.retryable || attempt >= maxRetries) return err as ApiErrorResult;
        lastError = err;
        const waitMs = backoff[Math.min(attempt, backoff.length - 1)] ?? 5_000;
        console.info("[api-retry]", { requestId, attempt: attempt + 1, waitMs, type: err.type });
        await sleep(waitMs);
        continue;
      }

      return {
        ok: true,
        data: body as T,
        requestId: typeof body.requestId === "string" ? body.requestId : requestId,
      };
    } catch (error) {
      clearTimeout(timeout);
      const err = classifyFetchError(error, requestId);
      console.warn("[network-error]", {
        requestId,
        url: String(input),
        method: options.method ?? "GET",
        attempt,
        message: err.technicalMessage,
      });

      if (!err.retryable || attempt >= maxRetries) return err;
      lastError = err;
      const waitMs = backoff[Math.min(attempt, backoff.length - 1)] ?? 5_000;
      console.info("[api-retry]", { requestId, attempt: attempt + 1, waitMs, type: err.type });
      await sleep(waitMs);
    }
  }

  return lastError ?? classifyFetchError(new Error("unknown"), requestId);
}

export function apiErrorToUserMessage(result: ApiErrorResult): string {
  return result.message;
}

export { USER_MESSAGES as API_USER_MESSAGES };
