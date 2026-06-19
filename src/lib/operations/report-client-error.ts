/** Reporta erro operacional ao servidor (fire-and-forget). */
export function reportClientOperationalError(payload: {
  errorType: string;
  title: string;
  message: string;
  technicalMessage?: string;
  probableCause: string;
  recommendedAction: string;
  uploadBatchId?: string;
  uploadFileId?: string;
  accountId?: string;
  platform?: "instagram" | "tiktok";
  metadata?: Record<string, unknown>;
}) {
  if (typeof window === "undefined") return;
  void fetch("/api/operations/errors", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).catch(() => undefined);
}
