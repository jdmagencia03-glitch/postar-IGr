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
  const trimmed = text.trim();

  if (!trimmed) {
    if (response.status === 504 || response.status === 502) {
      const err = new Error(
        "O servidor demorou demais. O progresso foi salvo — recarregue a página para continuar.",
      );
      (err as Error & { savedProgress?: boolean }).savedProgress = true;
      throw err;
    }
    throw new Error("Resposta vazia do servidor.");
  }

  if (trimmed.startsWith("<")) {
    const err = new Error(
      response.status === 504 || response.status === 502
        ? "O servidor demorou demais. O agendamento continua em segundo plano — recarregue a página."
        : "Erro temporário do servidor. Tente novamente em alguns segundos.",
    );
    if (response.status === 504 || response.status === 502) {
      (err as Error & { savedProgress?: boolean }).savedProgress = true;
    }
    throw err;
  }

  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    throw new Error(trimmed.slice(0, 160) || "Resposta inválida do servidor");
  }
}

function isTransientNetworkError(error: unknown) {
  if (!(error instanceof Error)) return false;
  const msg = error.message.toLowerCase();
  return (
    msg.includes("failed to fetch") ||
    msg.includes("networkerror") ||
    msg.includes("load failed") ||
    msg.includes("network request failed")
  );
}

function savedProgressError(message: string) {
  const err = new Error(message);
  (err as Error & { savedProgress?: boolean }).savedProgress = true;
  return err;
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
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
  let res: Response;
  try {
    res = await apiFetch(`/api/schedule-jobs/${jobId}/advance`, { method: "POST" });
  } catch (error) {
    if (isTransientNetworkError(error)) {
      throw savedProgressError(
        "A conexão caiu durante o agendamento. O progresso foi salvo — use Retomar agendamento.",
      );
    }
    throw error;
  }

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
    let advanced = false;
    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        status = await advanceScheduleJobApi(jobId);
        advanced = true;
        break;
      } catch (error) {
        status = await fetchScheduleJobStatus(jobId);
        onUpdate(status);

        if (terminal.has(status.status)) {
          return status;
        }

        const canRetry =
          status.isActive &&
          attempt < 4 &&
          (isTransientNetworkError(error) ||
            Boolean((error as Error & { savedProgress?: boolean }).savedProgress));

        if (canRetry) {
          await sleep(1500 * attempt);
          continue;
        }

        throw error;
      }
    }

    if (!advanced) break;

    onUpdate(status);
    if (terminal.has(status.status)) break;
    await sleep(300);
  }

  return status;
}
