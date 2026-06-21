/** Verbose upload logs — only when NEXT_PUBLIC_UPLOAD_DEBUG=true. */
export function isUploadDebugEnabled(): boolean {
  if (typeof process !== "undefined" && process.env.NEXT_PUBLIC_UPLOAD_DEBUG === "true") {
    return true;
  }
  return false;
}

export function uploadDebugLog(event: string, detail?: Record<string, unknown>) {
  if (!isUploadDebugEnabled()) return;
  if (typeof console !== "undefined") {
    console.info(`[upload-debug] ${event}`, detail ?? "");
  }
}
