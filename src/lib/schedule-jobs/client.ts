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
      throw savedProgressError(
        "O servidor demorou demais. O progresso foi salvo — recarregue a página para continuar.",
      );
    }
    throw new Error("Resposta vazia do servidor.");
  }

  if (trimmed.startsWith("<")) {
    throw savedProgressError(
      response.status === 504 || response.status === 502
        ? "O servidor demorou demais. O agendamento continua em segundo plano — recarregue a página."
        : "Erro temporário do servidor. Tente novamente em alguns segundos.",
    );
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
    msg.includes("network request failed") ||
    msg.includes("aborted")
  );
}

function savedProgressError(message: string) {
  const err = new Error(message);
  (err as Error & { savedProgress?: boolean }).savedProgress = true;
  return err;
}

function normalizeScheduleError(error: unknown) {
  if (error instanceof Error && (error as Error & { savedProgress?: boolean }).savedProgress) {
    return error;
  }
  if (isTransientNetworkError(error)) {
    return savedProgressError(
      "A conexão caiu durante o agendamento. O progresso foi salvo — use Retomar agendamento.",
    );
  }
  if (error instanceof Error) {
    return error;
  }
  return new Error("Erro no agendamento");
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
  let res: Response;
  try {
    res = await apiFetch(`/api/schedule-jobs/${jobId}/status`, { cache: "no-store" });
  } catch (error) {
    throw normalizeScheduleError(error);
  }
  const data = await readJsonResponse(res);
  if (!res.ok) throw new Error(String(data.error ?? "Falha ao carregar status"));
  return data as ScheduleJobStatusResponse;
}

export async function advanceScheduleJobApi(jobId: string) {
  let res: Response;
  try {
    res = await apiFetch(`/api/schedule-jobs/${jobId}/advance`, { method: "POST" });
  } catch (error) {
    throw normalizeScheduleError(error);
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
  let res: Response;
  try {
    res = await apiFetch(`/api/schedule-jobs/${jobId}/resume`, { method: "POST" });
  } catch (error) {
    throw normalizeScheduleError(error);
  }
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

/** Apenas acompanha o job — útil quando o cron do servidor continua processando. */
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

/** Processa o job até concluir ou falhar, chamando onUpdate a cada chunk. */
export async function runScheduleJobUntilDone(
  jobId: string,
  onUpdate: (status: ScheduleJobStatusResponse) => void,
  options?: { pollOnly?: boolean },
) {
  if (options?.pollOnly) {
    return pollScheduleJobUntilDone(jobId, onUpdate);
  }

  let status = await fetchScheduleJobStatus(jobId);
  onUpdate(status);

  const terminal = new Set(["completed", "partial_failed", "failed", "cancelled"]);
  let consecutiveErrors = 0;

  while (status.isActive && !terminal.has(status.status)) {
    let advanced = false;
    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        status = await advanceScheduleJobApi(jobId);
        advanced = true;
        consecutiveErrors = 0;
        break;
      } catch (error) {
        const refreshed = await safeFetchScheduleJobStatus(jobId, status);
        if (refreshed) {
          status = refreshed;
          onUpdate(status);
        }

        if (terminal.has(status.status)) {
          return status;
        }

        const normalized = normalizeScheduleError(error);
        const canRetry =
          status.isActive &&
          attempt < 5 &&
          (isTransientNetworkError(error) ||
            Boolean((normalized as Error & { savedProgress?: boolean }).savedProgress));

        if (canRetry) {
          await sleep(2000 * attempt);
          continue;
        }

        consecutiveErrors += 1;
        if (consecutiveErrors >= 2 && status.isActive) {
          throw savedProgressError(
            "A conexão ficou instável. O progresso foi salvo — clique em Retomar agendamento para continuar.",
          );
        }
        throw normalized;
      }
    }

    if (!advanced) break;

    onUpdate(status);
    if (terminal.has(status.status)) break;
    await sleep(500);
  }

  return status;
}
