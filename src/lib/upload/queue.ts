import type { SupabaseClient } from "@supabase/supabase-js";
import type { UploadBatchFile, UploadFileStatus, UploadSpeedMode } from "@/lib/types";
import {
  evaluateAdaptiveUpload,
  initialAdaptiveEffectiveMode,
  recommendSpeedModeForBatch,
  type AdaptiveEffectiveMode,
  type AdaptiveStabilityStatus,
} from "@/lib/upload/adaptive";
import { refreshBatchCounters } from "@/lib/upload/batches";
import {
  UPLOAD_BATCH_STALL_TIMEOUT_MS,
  UPLOAD_FILE_CONCURRENCY,
  UPLOAD_STALL_TIMEOUT_MS,
} from "@/lib/upload/storage-config";

/** Duração do lease de um worker sobre um arquivo. */
export const UPLOAD_FILE_LEASE_MS = 5 * 60_000;

export type UploadBatchHealth = {
  batchId: string;
  status: string;
  paused: boolean;
  total: number;
  completed: number;
  failed: number;
  pending: number;
  uploading: number;
  retrying: number;
  stalled: number;
  activeWorkers: number;
  expiredLeases: number;
  lastProgressAt: string | null;
  lastBatchProgressAt: string | null;
  isStalled: boolean;
  recommendedAction: string;
  currentConcurrency: UploadSpeedMode | null;
  progressPercent: number;
  currentMode: UploadSpeedMode | null;
  recommendedMode: UploadSpeedMode;
  targetConcurrency: number;
  effectiveMode: AdaptiveEffectiveMode;
  errorRate: number;
  retryRate: number;
  isDegraded: boolean;
  stability: AdaptiveStabilityStatus;
};

function isActiveFile(file: UploadBatchFile) {
  return !file.removed;
}

function fileProgress(file: UploadBatchFile) {
  const total = Number(file.file_size) || 0;
  if (file.status === "completed") return 100;
  return total > 0 ? Math.round((Number(file.bytes_uploaded ?? 0) / total) * 100) : 0;
}

function isLeaseExpired(file: UploadBatchFile, now = Date.now()) {
  if (!file.lease_until) return false;
  return new Date(file.lease_until).getTime() <= now;
}

function isProgressStale(file: UploadBatchFile, now = Date.now()) {
  if (file.status !== "uploading" && file.status !== "retrying") return false;
  const ref = file.last_progress_at ?? file.updated_at;
  return now - new Date(ref).getTime() >= UPLOAD_STALL_TIMEOUT_MS;
}

export function recommendUploadSpeedMode(fileCount: number): UploadSpeedMode {
  if (fileCount <= 50) return "turbo";
  if (fileCount <= 150) return "normal";
  return "economy";
}

export function largeBatchWarning(fileCount: number): string | null {
  if (fileCount <= 50) return null;
  if (fileCount <= 150) {
    return "Lotes médios: recomendamos velocidade Normal para maior estabilidade.";
  }
  if (fileCount <= 300) {
    return "Lote grande: recomendamos Econômico ou Normal. O Turbo pode causar travamentos.";
  }
  return "Lote muito grande (300+ vídeos): use modo estável e considere dividir em lotes menores.";
}

export async function claimUploadFileLease(
  supabase: SupabaseClient,
  params: {
    batchId: string;
    fileId: string;
    workerId: string;
    leaseMs?: number;
  },
): Promise<UploadBatchFile | null> {
  const now = new Date();
  const leaseUntil = new Date(now.getTime() + (params.leaseMs ?? UPLOAD_FILE_LEASE_MS)).toISOString();

  const { data: current } = await supabase
    .from("upload_files")
    .select("*")
    .eq("id", params.fileId)
    .eq("batch_id", params.batchId)
    .maybeSingle();

  if (!current || current.removed) return null;
  if (current.status === "completed" || current.status === "failed") return current as UploadBatchFile;

  const leasedToOther =
    current.worker_id &&
    current.worker_id !== params.workerId &&
    current.lease_until &&
    new Date(current.lease_until).getTime() > now.getTime();

  if (leasedToOther) return null;

  const { data, error } = await supabase
    .from("upload_files")
    .update({
      status: "uploading",
      worker_id: params.workerId,
      lease_until: leaseUntil,
      last_progress_at: now.toISOString(),
      updated_at: now.toISOString(),
    })
    .eq("id", params.fileId)
    .eq("batch_id", params.batchId)
    .in("status", ["pending", "retrying", "stalled", "uploading"])
    .select("*")
    .maybeSingle();

  if (error) throw new Error(error.message);
  return (data as UploadBatchFile) ?? null;
}

export async function renewUploadFileLease(
  supabase: SupabaseClient,
  params: {
    batchId: string;
    fileId: string;
    workerId: string;
    bytesUploaded?: number;
    leaseMs?: number;
  },
) {
  const now = new Date();
  const leaseUntil = new Date(now.getTime() + (params.leaseMs ?? UPLOAD_FILE_LEASE_MS)).toISOString();

  const patch: Record<string, unknown> = {
    worker_id: params.workerId,
    lease_until: leaseUntil,
    last_progress_at: now.toISOString(),
    updated_at: now.toISOString(),
    status: "uploading",
  };
  if (params.bytesUploaded !== undefined) {
    patch.bytes_uploaded = params.bytesUploaded;
  }

  const { data, error } = await supabase
    .from("upload_files")
    .update(patch)
    .eq("id", params.fileId)
    .eq("batch_id", params.batchId)
    .select("*")
    .maybeSingle();

  if (error) throw new Error(error.message);

  await supabase
    .from("upload_batches")
    .update({ last_progress_at: now.toISOString(), updated_at: now.toISOString() })
    .eq("id", params.batchId);

  return data as UploadBatchFile | null;
}

export async function releaseUploadFileLease(
  supabase: SupabaseClient,
  params: {
    batchId: string;
    fileId: string;
    status: UploadFileStatus;
    workerId?: string;
    publicUrl?: string | null;
    bytesUploaded?: number;
    errorMessage?: string | null;
    attemptCount?: number;
    refreshCounters?: boolean;
  },
) {
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = {
    status: params.status,
    worker_id: null,
    lease_until: null,
    updated_at: now,
  };

  if (params.publicUrl !== undefined) patch.public_url = params.publicUrl;
  if (params.bytesUploaded !== undefined) patch.bytes_uploaded = params.bytesUploaded;
  if (params.errorMessage !== undefined) patch.error_message = params.errorMessage;
  if (params.attemptCount !== undefined) patch.retry_count = params.attemptCount;

  if (params.status === "completed") {
    patch.completed_at = now;
    patch.failed_at = null;
    patch.error_message = null;
  }
  if (params.status === "failed") {
    patch.failed_at = now;
  }

  if (params.workerId) {
    // best-effort: only release if we still own the lease
  }

  let query = supabase
    .from("upload_files")
    .update(patch)
    .eq("id", params.fileId)
    .eq("batch_id", params.batchId);

  if (params.workerId) {
    query = query.eq("worker_id", params.workerId);
  }

  const { data, error } = await query.select("*").maybeSingle();

  const counters =
    params.refreshCounters === false
      ? undefined
      : await refreshBatchCounters(supabase, params.batchId);

  return { file: data as UploadBatchFile, counters };
}

export async function expireStaleUploadLeases(
  supabase: SupabaseClient,
  batchId: string,
): Promise<number> {
  const now = Date.now();
  const progressCutoff = new Date(now - UPLOAD_STALL_TIMEOUT_MS).toISOString();
  const leaseCutoff = new Date(now).toISOString();

  const { data: files, error } = await supabase
    .from("upload_files")
    .select("*")
    .eq("batch_id", batchId)
    .or("removed.is.null,removed.eq.false")
    .in("status", ["uploading", "retrying", "stalled"]);

  if (error) throw new Error(error.message);
  if (!files?.length) return 0;

  const toRelease =
    files.filter((row) => {
      const file = row as UploadBatchFile;
      if (isLeaseExpired(file, now)) return true;
      if (file.status === "stalled") return true;
      if (isProgressStale(file, now)) return true;
      if (
        file.status === "uploading" &&
        file.lease_until &&
        new Date(file.lease_until).getTime() < now
      ) {
        return true;
      }
      if (
        file.status === "uploading" &&
        file.last_progress_at &&
        file.last_progress_at < progressCutoff
      ) {
        return true;
      }
      return false;
    }) ?? [];

  if (!toRelease.length) return 0;

  const ids = toRelease.map((f) => f.id);
  const { error: updateError } = await supabase
    .from("upload_files")
    .update({
      status: "pending",
      worker_id: null,
      lease_until: null,
      updated_at: new Date().toISOString(),
    })
    .eq("batch_id", batchId)
    .in("id", ids);

  if (updateError) throw new Error(updateError.message);

  await refreshBatchCounters(supabase, batchId);
  return toRelease.length;
}

export async function getBatchUploadHealth(
  supabase: SupabaseClient,
  ownerId: string,
  batchId: string,
): Promise<UploadBatchHealth | null> {
  const { data: batchRow, error: batchError } = await supabase
    .from("upload_batches")
    .select(
      "id, status, total_files, completed_files, failed_files, updated_at, paused, upload_speed_mode, last_progress_at",
    )
    .eq("id", batchId)
    .eq("owner_id", ownerId)
    .maybeSingle();

  if (batchError) throw new Error(batchError.message);
  if (!batchRow) return null;

  const { data: files, error: filesError } = await supabase
    .from("upload_files")
    .select("*")
    .eq("batch_id", batchId)
    .order("sort_order", { ascending: true });

  if (filesError) throw new Error(filesError.message);

  const active = (files ?? []).filter((f) => isActiveFile(f as UploadBatchFile)) as UploadBatchFile[];
  const now = Date.now();

  let completed = 0;
  let failed = 0;
  let pending = 0;
  let uploading = 0;
  let retrying = 0;
  let stalled = 0;
  let expiredLeases = 0;
  const workers = new Set<string>();
  let lastProgressAt: string | null = batchRow.last_progress_at ?? null;

  for (const file of active) {
    switch (file.status) {
      case "completed":
        completed += 1;
        break;
      case "failed":
        failed += 1;
        break;
      case "uploading":
        uploading += 1;
        break;
      case "retrying":
        retrying += 1;
        break;
      case "stalled":
        stalled += 1;
        break;
      default:
        pending += 1;
    }

    if (file.worker_id) workers.add(file.worker_id);
    if (isLeaseExpired(file, now) || isProgressStale(file, now)) expiredLeases += 1;
    if (file.last_progress_at) {
      if (!lastProgressAt || file.last_progress_at > lastProgressAt) {
        lastProgressAt = file.last_progress_at;
      }
    }
  }

  const total = active.length;
  const progressPercent = total ? Math.round((completed / total) * 100) : 0;

  const lastBatchMs = lastProgressAt ? now - new Date(lastProgressAt).getTime() : Infinity;
  const hasPendingWork = pending + uploading + retrying + stalled > 0;
  const isStalled =
    batchRow.status === "uploading" &&
    !batchRow.paused &&
    hasPendingWork &&
    (lastBatchMs >= UPLOAD_BATCH_STALL_TIMEOUT_MS || expiredLeases > 0);

  let recommendedAction = "Continuar upload normalmente.";
  if (isStalled) {
    recommendedAction = "Executar reconciliação ou clicar em Recuperar upload.";
  } else if (failed > 0 && pending === 0 && uploading === 0) {
    recommendedAction = "Tentar novamente arquivos com erro ou agendar os concluídos.";
  }

  const userMode = (batchRow.upload_speed_mode as UploadSpeedMode) ?? "adaptive";
  const effectiveMode =
    userMode === "adaptive"
      ? initialAdaptiveEffectiveMode(total)
      : (userMode as AdaptiveEffectiveMode);

  const adaptive = evaluateAdaptiveUpload(
    {
      total,
      completed,
      failed,
      pending,
      uploading,
      retrying,
      stalled,
      lastProgressAt: lastProgressAt ? new Date(lastProgressAt).getTime() : null,
      currentEffectiveMode: effectiveMode,
      safeMode: failed >= 20,
      userSelectedMode: userMode,
    },
    UPLOAD_FILE_CONCURRENCY,
  );

  if (adaptive.shouldPauseUploads) {
    recommendedAction = "Muitas falhas — use Recuperar upload ou tente apenas os arquivos com erro.";
  } else if (adaptive.isDegraded && !isStalled) {
    recommendedAction = adaptive.userMessage ?? recommendedAction;
  }

  return {
    batchId,
    status: batchRow.status,
    paused: Boolean(batchRow.paused),
    total,
    completed,
    failed,
    pending,
    uploading,
    retrying,
    stalled,
    activeWorkers: workers.size,
    expiredLeases,
    lastProgressAt,
    lastBatchProgressAt: batchRow.last_progress_at ?? null,
    isStalled: isStalled || adaptive.isStalled,
    recommendedAction,
    currentConcurrency: userMode,
    progressPercent,
    currentMode: userMode,
    recommendedMode: recommendSpeedModeForBatch(total),
    targetConcurrency: adaptive.targetConcurrency,
    effectiveMode: adaptive.effectiveMode,
    errorRate: adaptive.errorRate,
    retryRate: adaptive.retryRate,
    isDegraded: adaptive.isDegraded,
    stability: adaptive.stability,
  };
}

export async function reconcileBatchUpload(
  supabase: SupabaseClient,
  ownerId: string,
  batchId: string,
): Promise<{ health: UploadBatchHealth; releasedLeases: number }> {
  const healthBefore = await getBatchUploadHealth(supabase, ownerId, batchId);
  if (!healthBefore) {
    throw new Error("Lote não encontrado");
  }

  const releasedLeases = await expireStaleUploadLeases(supabase, batchId);

  if (healthBefore.isStalled || releasedLeases > 0) {
    await supabase
      .from("upload_batches")
      .update({
        stall_detected_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", batchId);
  }

  const health = await getBatchUploadHealth(supabase, ownerId, batchId);
  if (!health) throw new Error("Lote não encontrado");

  return { health, releasedLeases };
}
