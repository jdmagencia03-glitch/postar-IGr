import { formatBytes } from "@/lib/upload/validate";

export function formatUploadErrorMessage(message: string, fileSize?: number) {
  const lower = message.toLowerCase();

  if (/size|limit|413|payload too large|entity too large|maximum|too big|exceeds/i.test(lower)) {
    const sizeHint = fileSize ? ` (${formatBytes(fileSize)})` : "";
    return `Arquivo${sizeHint} excede o limite do Supabase Storage. Rode supabase/storage-pro.sql no SQL Editor para liberar até 1 GB por vídeo.`;
  }

  if (/network|failed to fetch|timeout|aborted|offline/i.test(lower)) {
    return "Falha de conexão durante o envio. Use Continuar upload para retomar.";
  }

  if (/unauthorized|403|401|signature|token/i.test(lower)) {
    return "Sessão ou permissão de upload expirou. Recarregue a página e tente novamente.";
  }

  if (message.length > 220) {
    return `${message.slice(0, 220)}…`;
  }

  return message;
}
