import type { ScheduleJobStatusResponse } from "@/lib/schedule-jobs/types";

async function apiFetch(input: RequestInfo | URL, init?: RequestInit) {
  const response = await fetch(input, { ...init, credentials: "include" });
  if (response.status === 401) {
    window.location.href = "/login?next=/dashboard/bulk";
    throw new Error("Sessão expirada. Faça login novamente.");
  }
  return response;
}

async function readJsonResponse(response: Response) {
  const text = await response.text();
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(text.slice(0, 120) || "Resposta inválida do servidor");
  }
}

export async function createScheduleJobApi(body: Record<string, unknown>) {
  const res = await apiFetch("/api/schedule-jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await readJsonResponse(res);
  if (!res.ok) throw new Error(String(data.error ?? "Falha ao criar agendamento"));
  return data as { jobId: string; message?: string; reused?: boolean };
}

export async function fetchScheduleJobStatus(jobId: string) {
  const res = await apiFetch(`/api/schedule-jobs/${jobId}/status`, { cache: "no-store" });
  const data = await readJsonResponse(res);
  if (!res.ok) throw new Error(String(data.error ?? "Falha ao carregar status"));
  return data as ScheduleJobStatusResponse;
}

export async function advanceScheduleJobApi(jobId: string) {
  const res = await apiFetch(`/api/schedule-jobs/${jobId}/advance`, { method: "POST" });
  const data = await readJsonResponse(res);
  if (!res.ok) {
    const err = new Error(String(data.userMessage ?? data.error ?? "Falha no agendamento"));
    (err as Error & { savedProgress?: boolean }).savedProgress = Boolean(data.userMessage);
    throw err;
  }
  return data as ScheduleJobStatusResponse;
}

export async function resumeScheduleJobApi(jobId: string) {
  const res = await apiFetch(`/api/schedule-jobs/${jobId}/resume`, { method: "POST" });
  const data = await readJsonResponse(res);
  if (!res.ok) throw new Error(String(data.error ?? "Falha ao retomar"));
  return data as ScheduleJobStatusResponse;
}

export async function findActiveScheduleJobForBatch(uploadBatchId: string) {
  const res = await apiFetch(`/api/schedule-jobs?upload_batch_id=${uploadBatchId}`, {
    cache: "no-store",
  });
  const data = await readJsonResponse(res);
  if (!res.ok) return null;
  return (data.jobId as string | null) ?? null;
}

/** Processa o job até concluir ou falhar, chamando onUpdate a cada chunk. */
export async function runScheduleJobUntilDone(
  jobId: string,
  onUpdate: (status: ScheduleJobStatusResponse) => void,
) {
  let status = await fetchScheduleJobStatus(jobId);
  onUpdate(status);

  const terminal = new Set(["completed", "partial_failed", "failed", "cancelled"]);

  while (status.isActive && !terminal.has(status.status)) {
    try {
      status = await advanceScheduleJobApi(jobId);
    } catch (error) {
      status = await fetchScheduleJobStatus(jobId);
      onUpdate(status);
      throw error;
    }
    onUpdate(status);
    if (terminal.has(status.status)) break;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  return status;
}
