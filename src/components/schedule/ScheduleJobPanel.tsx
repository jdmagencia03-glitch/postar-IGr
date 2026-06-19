"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Check, ChevronDown, ChevronUp, Loader2, RefreshCw } from "lucide-react";
import type { ScheduleJobStatusResponse } from "@/lib/schedule-jobs/types";
import {
  fetchScheduleJobStatus,
  pollScheduleJobUntilDone,
  resumeScheduleJobApi,
  runScheduleJobUntilDone,
} from "@/lib/schedule-jobs/client";
import { SCHEDULE_JOB_FORCE_THRESHOLD } from "@/lib/schedule-jobs/constants";

type Props = {
  jobId: string;
  videoCount: number;
  onComplete?: (status: ScheduleJobStatusResponse) => void;
  onBatchRefresh?: () => void;
  autoRun?: boolean;
};

const STEP_ORDER = ["videos", "captions", "calendar", "inserting", "done"] as const;

function stepDone(status: ScheduleJobStatusResponse, step: (typeof STEP_ORDER)[number]) {
  if (step === "videos") return status.total > 0;
  if (step === "captions") return status.planChunksDone > 0 || status.currentStep === "inserting" || status.completed > 0;
  if (step === "calendar") return status.planChunksDone >= status.planChunksTotal && status.planChunksTotal > 0;
  if (step === "inserting") return status.insertChunksDone > 0 || status.completed > 0;
  if (step === "done") return status.status === "completed" || status.status === "partial_failed";
  return false;
}

function stepLabel(step: (typeof STEP_ORDER)[number], count: number) {
  if (step === "videos") return `${count} vídeos recebidos`;
  if (step === "captions") return "Legendas e hashtags sendo geradas";
  if (step === "calendar") return "Calendário sendo montado";
  if (step === "inserting") return "Posts sendo salvos";
  return "Agendamento concluído";
}

export function ScheduleJobPanel({
  jobId,
  videoCount,
  onComplete,
  onBatchRefresh,
  autoRun = true,
}: Props) {
  const [status, setStatus] = useState<ScheduleJobStatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const startedRef = useRef(false);

  const refresh = useCallback(async () => {
    const next = await fetchScheduleJobStatus(jobId);
    setStatus(next);
    return next;
  }, [jobId]);

  const runJob = useCallback(async () => {
    setRunning(true);
    setError(null);
    try {
      const final = await runScheduleJobUntilDone(jobId, setStatus);
      if (final.status === "completed" || final.status === "partial_failed") {
        onComplete?.(final);
        onBatchRefresh?.();
      }
    } catch (err) {
      const saved =
        err instanceof Error &&
        "savedProgress" in err &&
        Boolean((err as Error & { savedProgress?: boolean }).savedProgress);
      setError(
        saved
          ? err instanceof Error
            ? err.message
            : "A conexão caiu durante o agendamento. O progresso foi salvo — use Retomar agendamento."
          : err instanceof Error
            ? err.message.includes("Failed to fetch")
              ? "A conexão caiu durante o agendamento. O progresso foi salvo — use Retomar agendamento."
              : err.message
            : "Erro no agendamento",
      );
      await refresh().catch(() => undefined);
    } finally {
      setRunning(false);
    }
  }, [jobId, onComplete, onBatchRefresh, refresh, videoCount]);

  const handleResume = useCallback(async () => {
    setRunning(true);
    setError(null);
    try {
      await resumeScheduleJobApi(jobId);
      await runScheduleJobUntilDone(jobId, setStatus);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message.includes("Failed to fetch")
            ? "A conexão caiu. O progresso foi salvo — tente Retomar novamente em alguns segundos."
            : err.message
          : "Falha ao retomar",
      );
      await refresh().catch(() => undefined);
    } finally {
      setRunning(false);
    }
  }, [jobId, refresh]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const initial = await fetchScheduleJobStatus(jobId);
        if (cancelled) return;
        setStatus(initial);
        if (autoRun && !startedRef.current && initial.isActive) {
          startedRef.current = true;
          if (videoCount >= SCHEDULE_JOB_FORCE_THRESHOLD) {
            void runScheduleJobUntilDone(jobId, setStatus).then((final) => {
              if (final.status === "completed" || final.status === "partial_failed") {
                onComplete?.(final);
                onBatchRefresh?.();
              }
            }).catch(async (err) => {
              const saved =
                err instanceof Error &&
                "savedProgress" in err &&
                Boolean((err as Error & { savedProgress?: boolean }).savedProgress);
              setError(
                saved || (err instanceof Error && err.message.includes("Failed to fetch"))
                  ? "Processamento iniciado. Se a conexão cair, clique em Retomar agendamento — o progresso fica salvo."
                  : err instanceof Error
                    ? err.message
                    : "Erro no agendamento",
              );
              await refresh().catch(() => undefined);
              void pollScheduleJobUntilDone(jobId, setStatus, { intervalMs: 5000 });
            });
          } else {
            void runJob();
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message.includes("Failed to fetch")
                ? "Falha de conexão ao carregar o agendamento. Recarregue a página."
                : err.message
              : "Falha ao carregar job",
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [jobId, autoRun, runJob, videoCount, onComplete, onBatchRefresh, refresh]);

  useEffect(() => {
    if (!status?.isActive || running) return;
    const id = window.setInterval(() => {
      void refresh().catch(() => undefined);
    }, 4000);
    return () => window.clearInterval(id);
  }, [status?.isActive, running, refresh]);

  const processedCount = status?.completed ?? 0;
  const failedCount = status?.failed ?? 0;
  const total = status?.total ?? videoCount;
  const progressPct = total ? Math.round((processedCount / total) * 100) : 0;
  const isDone = status?.status === "completed";
  const isPartial = status?.status === "partial_failed";
  const canResume = Boolean((status?.canResume || (status?.isActive && error)) && !running);

  return (
    <section className="ig-panel space-y-4 p-5">
      <div>
        <p className="text-sm font-semibold text-ig-text">
          {isDone
            ? "Agendamento concluído"
            : isPartial
              ? "Agendamento parcialmente concluído"
              : "Agendamento em andamento"}
        </p>
        <p className="mt-1 text-sm text-ig-muted">
          {processedCount} de {total} processados
          {failedCount > 0 ? ` · ${failedCount} com erro` : ""}
        </p>
        {status && (
          <p className="mt-1 text-xs text-ig-muted">
            Etapa atual: {status.stepLabel}
            {status.planChunksTotal > 0 && (
              <>
                {" "}
                · Chunks de plano: {status.planChunksDone} de {status.planChunksTotal}
              </>
            )}
            {status.insertChunksTotal > 0 && status.currentStep === "inserting" && (
              <>
                {" "}
                · Chunks de inserção: {status.insertChunksDone} de {status.insertChunksTotal}
              </>
            )}
          </p>
        )}
      </div>

      <div className="h-2 overflow-hidden rounded-full bg-ig-secondary">
        <div
          className="h-full rounded-full bg-ig-primary transition-all duration-300"
          style={{ width: `${progressPct}%` }}
        />
      </div>

      <div className="space-y-1">
        {STEP_ORDER.map((step) => {
          const done = status ? stepDone(status, step) : step === "videos";
          return (
            <p
              key={step}
              className={`flex items-center gap-2 text-sm ${done ? "text-ig-text" : "text-ig-muted"}`}
            >
              {done ? <Check size={16} className="text-ig-primary" /> : running ? <Loader2 size={14} className="animate-spin" /> : <span className="w-4" />}
              {done ? "✓ " : ""}
              {stepLabel(step, videoCount)}
            </p>
          );
        })}
      </div>

      {status?.scheduleSummary && (
        <p className="text-xs text-ig-muted">{status.scheduleSummary}</p>
      )}

      {error && (
        <div className="rounded-xl border border-ig-danger/30 bg-ig-danger/5 px-4 py-3 text-sm text-ig-danger">
          {error}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {canResume && (
          <button
            type="button"
            onClick={() => void handleResume()}
            disabled={running}
            className="ig-btn-secondary inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold disabled:opacity-50"
          >
            <RefreshCw size={16} />
            Retomar agendamento
          </button>
        )}
        <Link href="/dashboard/calendar" className="ig-btn-secondary px-4 py-2 text-sm font-semibold">
          Abrir calendário
        </Link>
        <button
          type="button"
          onClick={() => setShowDetails((v) => !v)}
          className="ig-btn-secondary inline-flex items-center gap-1 px-4 py-2 text-sm font-semibold"
        >
          {showDetails ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          Ver detalhes
        </button>
      </div>

      {showDetails && status && (
        <dl className="grid gap-2 rounded-xl border border-ig-border bg-ig-secondary/30 p-3 text-xs text-ig-muted sm:grid-cols-2">
          <div>
            <dt>Job</dt>
            <dd className="font-mono text-ig-text">{status.jobId.slice(0, 8)}…</dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd className="text-ig-text">{status.status}</dd>
          </div>
          <div>
            <dt>Pendentes</dt>
            <dd className="text-ig-text">{status.pending}</dd>
          </div>
          <div>
            <dt>Com legenda/plano</dt>
            <dd className="text-ig-text">{status.processed}</dd>
          </div>
          {status.errorMessage && (
            <div className="sm:col-span-2">
              <dt>Erro técnico</dt>
              <dd className="text-ig-danger">{status.errorMessage}</dd>
            </div>
          )}
        </dl>
      )}
    </section>
  );
}
