import { formatBytes } from "@/lib/upload/validate";

/** Erro HTTP/claro de limite de tamanho no storage. */
function isExplicitStorageSizeLimitError(message: string) {
  const lower = message.toLowerCase();
  return /413|payload too large|entity too large|maximum allowed size|file_size_limit|object exceeded the maximum|too large to upload|size limit exceeded|exceeded the maximum allowed/i.test(
    lower,
  );
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

  const overConfiguredLimit =
    hasKnownLimit && fileSize != null && fileSize > maxBytes;

  if (overConfiguredLimit) {
    const sizeHint = formatBytes(fileSize);
    const limitHint = formatBytes(maxBytes);
    return `Arquivo (${sizeHint}) excede o limite configurado (${limitHint}).`;
  }

  if (isExplicitStorageSizeLimitError(trimmed) && !withinKnownLimit) {
    const sizeHint = fileSize ? ` (${formatBytes(fileSize)})` : "";
    const limitHint = hasKnownLimit ? ` (limite configurado: ${formatBytes(maxBytes)})` : "";
    return `Arquivo${sizeHint} excede o limite do Supabase Storage${limitHint}. Confira Storage → media → Settings ou rode supabase/storage-pro.sql. Detalhe: ${trimmed}`;
  }

  if (/network|failed to fetch|timeout|aborted|offline/i.test(trimmed)) {
    return "Falha de conexão durante o envio. Use Continuar upload para retomar.";
  }

  if (/unauthorized|403|401|signature|token|jwt|expired/i.test(trimmed)) {
    return "Sessão ou permissão de upload expirou. Recarregue a página e tente novamente.";
  }

  if (trimmed.length > 280) {
    return `${trimmed.slice(0, 280)}…`;
  }

  return trimmed;
}
