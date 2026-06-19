/**
 * Correção estrutural do Upload em Lote — orquestração unificada.
 *
 * Pilares (em ordem de prioridade):
 * 1. Fila persistente (queue.ts) — status por arquivo, leases, idempotência
 * 2. Watchdog (session-store) — stall, libera workers, não trava o lote
 * 3. Reconciliação (reconcile-state.ts + batch-status.ts) — backend = fonte de verdade
 * 4. Upload adaptativo (adaptive.ts) — reduz concorrência em instabilidade
 * 5. Central de Erros (operational-errors) — registra degradação e recuperação
 */

import type { OperationalErrorSeverity, OperationalErrorStatus } from "@/lib/types";
import type { UploadBatchHealth } from "@/lib/upload/queue";
import { reconcileUploadState } from "@/lib/upload/reconcile-state";

export const UPLOAD_BATCH_RESILIENCE_VERSION = "1.0.0";

export type StructuralRecoveryReason =
  | "manual_recover"
  | "batch_watchdog"
  | "stall_detected"
  | "foreground"
  | "polling"
  | "engine_finished";

export type StructuralRecoveryResult = {
  batch: Awaited<ReturnType<typeof reconcileUploadState>>["batch"];
  health: UploadBatchHealth;
  releasedLeases: number;
};

/** Fase 1+3: reconcilia fila persistente no servidor (libera leases, recoloca pendentes). */
export async function reconcileBatchStructuralState(
  batchId: string,
): Promise<StructuralRecoveryResult> {
  const result = await reconcileUploadState(batchId);
  return {
    batch: result.batch,
    health: result.health,
    releasedLeases: result.releasedLeases,
  };
}

export function shouldReportHealthToErrorCenter(health: UploadBatchHealth) {
  return (
    health.isStalled ||
    health.isDegraded ||
    health.stability === "safe_mode" ||
    health.expiredLeases > 0 ||
    health.failed >= 10
  );
}

export function buildHealthOperationalError(health: UploadBatchHealth, releasedLeases: number) {
  if (health.isStalled) {
    return {
      errorType: "upload_batch_stalled",
      title: "Lote de upload travado",
      message: `${health.completed}/${health.total} concluídos · ${health.stalled} travados · ${health.expiredLeases} lease(s) expirado(s).`,
      probableCause: "Worker parado, lease expirado ou progresso sem atualização.",
      recommendedAction: health.recommendedAction,
      severity: (health.expiredLeases >= 3 ? "critical" : "high") as OperationalErrorSeverity,
      status: "auto_retrying" as OperationalErrorStatus,
      metadata: { releasedLeases, ...health },
    };
  }

  if (health.stability === "safe_mode" || health.failed >= 20) {
    return {
      errorType: "upload_safe_mode",
      title: "Modo seguro de upload",
      message: `${health.failed} falhas em lote de ${health.total} vídeos. Concorrência reduzida.`,
      probableCause: "Muitas falhas acumuladas em lote grande.",
      recommendedAction: "Aguarde recuperação automática ou use Recuperar upload.",
      severity: "high" as OperationalErrorSeverity,
      status: "auto_retrying" as OperationalErrorStatus,
      metadata: { releasedLeases, ...health },
    };
  }

  if (health.isDegraded) {
    return {
      errorType: "upload_degraded",
      title: "Upload instável no lote",
      message: `Taxa de erro ${Math.round(health.errorRate * 100)}% · ${health.retrying} reconectando.`,
      probableCause: "Saturação de workers ou conexão instável em lote grande.",
      recommendedAction: health.recommendedAction,
      severity: "medium" as OperationalErrorSeverity,
      status: "auto_retrying" as OperationalErrorStatus,
      metadata: { releasedLeases, ...health },
    };
  }

  return null;
}
