import type { ScheduleJobStatusResponse } from "@/lib/schedule-jobs/types";
import { safeFetch } from "@/lib/api/client";

async function readScheduleJobResponse<T extends Record<string, unknown>>(result: Awaited<ReturnType<typeof safeFetch<T>>>) {
  if (!result.ok) throw new Error(result.message);
  return result.data as ScheduleJobStatusResponse & T;
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function safeFetchScheduleJobStatus(jobId: string, fallback?: ScheduleJobStatusResponse) {
  try {
    return await fetchScheduleJobStatus(jobId);
  } catch {
    return fallback;
  }
}

export async function createScheduleJobApi(body: Record<string, unknown>) {
  const result = await safeFetch<{ jobId: string; message?: string; reused?: boolean }>(
    "/api/schedule-jobs",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      idempotencyKey: String(body.upload_batch_id ?? body.uploadBatchId ?? ""),
    },
  );
  if (!result.ok) throw new Error(result.message);
  return result.data;
}

export async function fetchScheduleJobStatus(jobId: string) {
  const result = await safeFetch<ScheduleJobStatusResponse>(`/api/schedule-jobs/${jobId}/status`, {
    cache: "no-store",
  });
  return readScheduleJobResponse(result);
}

export async function kickScheduleJobApi(jobId: string) {
  const result = await safeFetch<ScheduleJobStatusResponse>(`/api/schedule-jobs/${jobId}/kick`, {
    method: "POST",
  });
  return readScheduleJobResponse(result);
}

export async function resumeScheduleJobApi(jobId: string) {
  const result = await safeFetch<ScheduleJobStatusResponse>(`/api/schedule-jobs/${jobId}/resume`, {
    method: "POST",
    timeoutMs: 120_000,
  });
  return readScheduleJobResponse(result);
}

export async function forceContinueScheduleJobApi(jobId: string) {
  const result = await safeFetch<ScheduleJobStatusResponse>(
    `/api/schedule-jobs/${jobId}/force-continue`,
    { method: "POST", timeoutMs: 120_000 },
  );
  return readScheduleJobResponse(result);
}

export async function finalizePostsScheduleJobApi(jobId: string) {
  const result = await safeFetch<ScheduleJobStatusResponse>(
    `/api/schedule-jobs/${jobId}/finalize-posts`,
    { method: "POST", timeoutMs: 300_000 },
  );
  return readScheduleJobResponse(result);
}

export async function fetchScheduleJobDiagnostics(jobId: string) {
  const result = await safeFetch<Record<string, unknown>>(`/api/schedule-jobs/${jobId}/diagnostics`, {
    cache: "no-store",
  });
  if (!result.ok) throw new Error(result.message);
  return result.data;
}

export async function cancelScheduleJobApi(jobId: string) {
  const result = await safeFetch<ScheduleJobStatusResponse>(`/api/schedule-jobs/${jobId}/cancel`, {
    method: "POST",
  });
  return readScheduleJobResponse(result);
}

export async function findActiveScheduleJobForBatch(uploadBatchId: string) {
  const result = await safeFetch<{ jobId: string | null }>(
    `/api/schedule-jobs?upload_batch_id=${uploadBatchId}`,
    { cache: "no-store" },
  );
  if (!result.ok) return null;
  return result.data.jobId ?? null;
}

/** Apenas acompanha o job — o processamento roda no servidor. */
export async function pollScheduleJobUntilDone(
  jobId: string,
  onUpdate: (status: ScheduleJobStatusResponse) => void,
  options?: { intervalMs?: number },
) {
  const intervalMs = options?.intervalMs ?? 5000;
  const terminal = new Set(["completed", "partial_failed", "failed", "cancelled"]);

  let status = await fetchScheduleJobStatus(jobId);
  onUpdate(status);

  while (status.isActive && !terminal.has(status.status)) {
    await sleep(intervalMs);
    status = (await safeFetchScheduleJobStatus(jobId, status)) ?? status;
    onUpdate(status);
  }

  return status;
}
