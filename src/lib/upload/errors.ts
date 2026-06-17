import { formatBytes } from "@/lib/upload/validate";

function isStorageSizeLimitError(message: string) {
  const lower = message.toLowerCase();
  return (
    /413|payload too large|entity too large|maximum allowed size|max(imum)? file size|file_size_limit|object exceeded|too large to upload|size limit exceeded/i.test(
      lower,
    ) ||
    (/\blimit\b/.test(lower) && /\b(size|mb|gb|bytes)\b/.test(lower))
  );
}

export function formatUploadErrorMessage(
  message: string,
  fileSize?: number,
  maxBytes?: number,
) {
  const overConfiguredLimit =
    maxBytes != null && fileSize != null && fileSize > maxBytes && maxBytes > 0;

  if (isStorageSizeLimitError(message) || overConfiguredLimit) {
    const sizeHint = fileSize ? ` (${formatBytes(fileSize)})` : "";
    const limitHint =
      maxBytes && maxBytes > 0 ? ` (limite atual: ${formatBytes(maxBytes)})` : " (até 500 MB)";
    return `Arquivo${sizeHint} excede o limite do Supabase Storage${limitHint}. Confira Storage → media → Settings ou rode supabase/storage-pro.sql.`;
  }

  if (/network|failed to fetch|timeout|aborted|offline/i.test(message)) {
    return "Falha de conexão durante o envio. Use Continuar upload para retomar.";
  }

  if (/unauthorized|403|401|signature|token/i.test(message)) {
    return "Sessão ou permissão de upload expirou. Recarregue a página e tente novamente.";
  }

  if (message.length > 220) {
    return `${message.slice(0, 220)}…`;
  }

  return message;
}
