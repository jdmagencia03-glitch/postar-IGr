import type { UploadBatch } from "@/lib/types";
import type { UploadBatchHealth } from "@/lib/upload/queue";
import { refreshUploadBatch } from "@/lib/upload/client";

export type ReconcileUploadStateResult = {
  batch: UploadBatch;
  health: UploadBatchHealth;
  releasedLeases: number;
};

/** Reconcilia estado do lote com o backend (fonte de verdade). */
export async function reconcileUploadState(batchId: string): Promise<ReconcileUploadStateResult> {
  const response = await fetch(`/api/upload/batches/${batchId}/reconcile`, {
    method: "POST",
    credentials: "include",
  });

  const payload = (await response.json()) as ReconcileUploadStateResult & { error?: string };
  if (!response.ok) {
    throw new Error(payload.error ?? "Falha ao reconciliar upload");
  }

  const batch = await refreshUploadBatch(batchId);
  return {
    batch,
    health: payload.health,
    releasedLeases: payload.releasedLeases,
  };
}

export async function fetchUploadBatchHealth(batchId: string): Promise<UploadBatchHealth> {
  const response = await fetch(`/api/upload/batches/${batchId}/health`, {
    credentials: "include",
    cache: "no-store",
  });
  const payload = (await response.json()) as UploadBatchHealth & { error?: string };
  if (!response.ok) {
    throw new Error(payload.error ?? "Falha ao carregar saúde do lote");
  }
  return payload;
}

export function createUploadWorkerId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `worker-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

async function claimUploadFileLeaseApi(batchId: string, fileId: string, workerId: string) {
  const response = await fetch(`/api/upload/batches/${batchId}/files/${fileId}/claim`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workerId }),
  });
  const payload = (await response.json()) as { file?: unknown; alreadyCompleted?: boolean; error?: string };
  if (response.status === 409) return null;
  if (!response.ok) {
    throw new Error(payload.error ?? "Falha ao reservar arquivo");
  }
  return payload;
}

export { claimUploadFileLeaseApi };
