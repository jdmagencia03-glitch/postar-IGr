import type { UploadBatchStatus } from "@/lib/types";

const TERMINAL_BATCH_STATUSES: UploadBatchStatus[] = [
  "ready",
  "scheduled",
  "cancelled",
];

const SUCCESS_TERMINAL_STATUSES: UploadBatchStatus[] = ["ready", "scheduled"];

/** Lote em estado final — não mostrar "Cancelar lote" como ação principal. */
export function isUploadBatchTerminal(status: UploadBatchStatus | undefined | null): boolean {
  if (!status) return false;
  return TERMINAL_BATCH_STATUSES.includes(status);
}

/** Upload concluído com sucesso (com ou sem agendamento). */
export function isUploadBatchSuccessTerminal(status: UploadBatchStatus | undefined | null): boolean {
  if (!status) return false;
  return SUCCESS_TERMINAL_STATUSES.includes(status);
}

/** Fluxo completo: vídeos enviados e agendados. */
export function isUploadBatchFullyScheduled(status: UploadBatchStatus | undefined | null): boolean {
  return status === "scheduled";
}
