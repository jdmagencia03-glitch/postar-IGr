type CaptionDebugPayload = Record<string, unknown>;

/** Logs temporários para depuração da geração de legendas. */
export function logCaptionGeneration(event: string, payload: CaptionDebugPayload) {
  console.info(`[caption-gen] ${event}`, payload);
}
