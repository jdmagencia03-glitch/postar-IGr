import { formatBytes } from "@/lib/upload/validate";

type TusLikeError = Error & {
  originalResponse?: {
    getStatus?: () => number;
    getBody?: () => string;
  };
};

export function humanizeFetchError(error: unknown): string {
  if (error instanceof Error) {
    const message = error.message.trim();
    if (
      /failed to fetch|networkerror|network error|load failed|fetch failed|network request failed|err_internet_disconnected|aborted|timeout/i.test(
        message,
      )
    ) {
      return "Falha de conexão com o servidor. Verifique sua internet, aguarde alguns segundos e tente de novo.";
    }
    return message || "Erro de conexão ao contactar o servidor.";
  }
  return "Erro de conexão ao contactar o servidor.";
}

/** Extrai mensagem legível de erros TUS / fetch. */
export function extractUploadErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error ?? "Erro desconhecido no upload");
  }

  const tusError = error as TusLikeError;
  const status = tusError.originalResponse?.getStatus?.();
  const body = tusError.originalResponse?.getBody?.()?.trim();

  if (body) {
    try {
      const parsed = JSON.parse(body) as { message?: string; error?: string };
      const fromJson = parsed.message ?? parsed.error;
      if (fromJson) {
        return status ? `[${status}] ${fromJson}` : fromJson;
      }
    } catch {
      // body não é JSON
    }
    return status ? `[${status}] ${body}` : body;
  }

  const message = error.message.trim();
  const responseMatch = message.match(/response text:\s*([^,]+(?:,\s*request id)?)/i);
  if (responseMatch?.[1]) {
    return responseMatch[1].replace(/,\s*request id.*$/i, "").trim();
  }

  return humanizeFetchError(error);
}

function isExplicitStorageSizeLimitError(message: string) {
  const lower = message.toLowerCase();
  return /413|payload too large|entity too large|maximum allowed size|file_size_limit|object exceeded the maximum|too large to upload|size limit exceeded|exceeded the maximum allowed/i.test(
    lower,
  );
}

function isStaleFalseLimitMessage(message: string) {
  return /excede o limite do supabase storage/i.test(message);
}

export function formatUploadErrorMessage(
  message: string,
  fileSize?: number,
  maxBytes?: number,
) {
  const trimmed = message.trim();
  if (!trimmed) return "Erro desconhecido no upload.";

  const hasKnownLimit = maxBytes != null && maxBytes > 0;
  const withinKnownLimit =
    hasKnownLimit && fileSize != null && fileSize > 0 && fileSize <= maxBytes;

  if (withinKnownLimit && isStaleFalseLimitMessage(trimmed)) {
    return "Falha ao enviar para o Supabase (não é limite de tamanho — o vídeo cabe no plano). Clique em Tentar novamente.";
  }

  const overConfiguredLimit =
    hasKnownLimit && fileSize != null && fileSize > maxBytes;

  if (overConfiguredLimit) {
    return `Arquivo (${formatBytes(fileSize)}) excede o limite (${formatBytes(maxBytes)}).`;
  }

  if (withinKnownLimit && isExplicitStorageSizeLimitError(trimmed)) {
    return `Arquivo (${formatBytes(fileSize!)}) foi rejeitado pelo Supabase (${trimmed}). O bucket aceita até ${formatBytes(maxBytes!)}, mas o limite global do projeto provavelmente ainda está em 50 MB. No Supabase: Storage → Settings → Global file size limit → 500 MB. Depois clique em Tentar novamente.`;
  }

  if (isExplicitStorageSizeLimitError(trimmed) && !withinKnownLimit) {
    const sizeHint = fileSize ? ` (${formatBytes(fileSize)})` : "";
    const limitHint = hasKnownLimit ? ` Limite do bucket: ${formatBytes(maxBytes)}.` : "";
    return `Arquivo${sizeHint} excede o limite do Supabase Storage.${limitHint} Detalhe: ${trimmed}`;
  }

  if (/network|failed to fetch|timeout|aborted|offline|connection|falha de conexão/i.test(trimmed)) {
    return "Falha de conexão — o sistema vai tentar de novo automaticamente. Se persistir, clique em Continuar upload.";
  }

  if (/unauthorized|403|401|signature|token|jwt|expired/i.test(trimmed)) {
    return "Sessão ou permissão de upload expirou. Recarregue a página e tente novamente.";
  }

  if (trimmed.length > 320) {
    return `${trimmed.slice(0, 320)}…`;
  }

  return trimmed;
}

export function displayUploadErrorMessage(
  message: string | null | undefined,
  fileSize?: number,
  maxBytes?: number,
) {
  if (!message?.trim()) return null;
  return formatUploadErrorMessage(message, fileSize, maxBytes);
}
