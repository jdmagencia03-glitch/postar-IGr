"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronUp,
  Loader2,
  RefreshCw,
  XCircle,
} from "lucide-react";
import type { ScheduleJobStatusResponse } from "@/lib/schedule-jobs/types";
import type { ScheduleStepId } from "@/lib/schedule-jobs/state";
import {
  jobBannerForWorker,
  PollingStateTracker,
  type PollingDisplayState,
} from "@/lib/connection-state";
import {
  cancelScheduleJobApi,
  fetchScheduleJobDiagnostics,
  fetchScheduleJobStatus,
  finalizePostsScheduleJobApi,
  forceContinueScheduleJobApi,
  kickScheduleJobInBackground,
  resumeScheduleJobApi,
} from "@/lib/schedule-jobs/client";
import {
  buildOptimisticScheduleJobStatus,
  isScheduleJobTerminal,
  shouldPollScheduleJob,
} from "@/lib/schedule-jobs/optimistic-status";
import { isSmallScheduleJob, scheduleJobPollIntervalMs } from "@/lib/schedule-jobs/polling";
import { BatchCompletionActions } from "@/components/upload/BatchCompletionActions";
import type { SocialPlatform } from "@/lib/types";

type Props = {
  jobId: string;
  videoCount: number;
  initialStatus?: ScheduleJobStatusResponse | null;
  platform?: SocialPlatform;
  accountId?: string;
  batchId?: string | null;
  onComplete?: (status: ScheduleJobStatusResponse) => void;
  onBatchRefresh?: () => void;
  onStartNewBatch?: () => void;
};

const STEP_ORDER: Array<{
  id: ScheduleStepId;
  label: (count: number, done: boolean) => string;
}> = [
  { id: "videos", label: (count) => `${count} vídeos recebidos` },
  { id: "captions", label: () => "Legendas e hashtags" },
  { id: "calendar", label: () => "Calendário montado" },
  { id: "posts", label: () => "Posts salvos no calendário" },
  {
    id: "done",
    label: (_count, done) => (done ? "Agendamento concluído" : "Finalização"),
  },
];

function stepIcon(state: "pending" | "active" | "done" | "error") {
  if (state === "done") return <Check size={16} className="text-ig-primary" />;
  if (state === "error") return <AlertCircle size={16} className="text-ig-danger" />;
  if (state === "active") {
    return <Loader2 size={14} className="animate-spin text-ig-primary" />;
  }
  return <span className="inline-block h-4 w-4 rounded-full border border-ig-border" />;
}

function statusBanner(
  status: ScheduleJobStatusResponse,
  pollDisplay: PollingDisplayState | null,
) {
  if (status.isStalled) {
    return "Agendamento sem progresso detectado — use as ações abaixo para continuar sem duplicar posts.";
  }
  if (status.phase === "queued") {
    return "Seu agendamento está na fila. Ele começará automaticamente.";
  }
  if (status.phase === "completed") {
    return `Agendamento concluído. ${status.postsSaved} posts foram salvos no calendário.`;
  }
  if (status.phase === "partial_completed") {
    return `Agendamento concluído parcialmente. ${status.postsSaved} posts salvos, ${status.failed} itens com erro.`;
  }
  if (status.phase === "failed" || status.phase === "paused_needs_action") {
    return "O agendamento foi pausado. O progresso foi salvo — você pode retomar sem duplicar posts.";
  }

  if (pollDisplay && pollDisplay.consecutiveFailures >= 3 && pollDisplay.userMessage) {
    return pollDisplay.userMessage;
  }
  if (pollDisplay && pollDisplay.consecutiveFailures >= 1 && status.isActive) {
    if (pollDisplay.consecutiveFailures >= 2 && pollDisplay.userMessage) {
      return pollDisplay.userMessage;
    }
    return "Atualizando status…";
  }

  if (status.isActive) {
    const workerBanner = jobBannerForWorker(status.workerStatus, false);
    if (workerBanner) return workerBanner;
    return "Agendamento em andamento no servidor. Você pode fechar esta aba.";
  }
  return null;
}

export function ScheduleJobPanel({
  jobId,
  videoCount,
  initialStatus = null,
  platform = "instagram",
  accountId,
  batchId,
  onComplete,
  onBatchRefresh,
  onStartNewBatch,
}: Props) {
  const smallBatch = isSmallScheduleJob(videoCount);
  const [status, setStatus] = useState<ScheduleJobStatusResponse | null>(
    () => initialStatus ?? buildOptimisticScheduleJobStatus(jobId, videoCount),
  );
  const [pollDisplay, setPollDisplay] = useState<PollingDisplayState | null>(null);
  const pollTrackerRef = useRef(new PollingStateTracker());
  const [action, setAction] = useState<
    null | "resume" | "force" | "finalize" | "cancel" | "diagnostics"
  >(null);
  const [diagnostics, setDiagnostics] = useState<Record<string, unknown> | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const completedRef = useRef(false);

  const applyStatus = useCallback(
    (next: ScheduleJobStatusResponse) => {
      setStatus(next);
      setPollDisplay(
        pollTrackerRef.current.recordSuccess(
          `/api/schedule-jobs/${jobId}/status`,
        ),
      );

      if (
        !completedRef.current &&
        (next.phase === "completed" || next.phase === "partial_completed")
      ) {
        completedRef.current = true;
        onComplete?.(next);
        onBatchRefresh?.();
      }
    },
    [jobId, onBatchRefresh, onComplete],
  );

  const refresh = useCallback(async () => {
    const endpoint = `/api/schedule-jobs/${jobId}/status`;
    const started = Date.now();
    try {
      const next = await fetchScheduleJobStatus(jobId);
      applyStatus(next);
      return next;
    } catch (error) {
      const display = pollTrackerRef.current.recordFailure(
        { source: "error", error, endpoint },
        { endpoint, jobId, elapsedMs: Date.now() - started },
      );
      setPollDisplay(display);
      console.warn("[worker-status]", {
        jobId,
        pollFailures: display.consecutiveFailures,
        kind: display.kind,
        connectionStatus: display.connectionStatus,
      });
      return null;
    }
  }, [applyStatus, jobId]);

  const runAction = useCallback(
    async (
      kind: "resume" | "force" | "finalize" | "cancel" | "diagnostics",
      fn: () => Promise<ScheduleJobStatusResponse | Record<string, unknown>>,
    ) => {
      setAction(kind);
      setActionError(null);
      try {
        const result = await fn();
        if (kind === "diagnostics") {
          setDiagnostics(result as Record<string, unknown>);
          setShowDetails(true);
        } else {
          applyStatus(result as ScheduleJobStatusResponse);
        }
      } catch (err) {
        setActionError(err instanceof Error ? err.message : "Falha na ação");
        await refresh();
      } finally {
        setAction(null);
      }
    },
    [applyStatus, refresh],
  );

  useEffect(() => {
    if (initialStatus) {
      setStatus(initialStatus);
    }
  }, [initialStatus]);

  useEffect(() => {
    completedRef.current = false;
    pollTrackerRef.current = new PollingStateTracker();
    setStatus(initialStatus ?? buildOptimisticScheduleJobStatus(jobId, videoCount));

    if (smallBatch) {
      kickScheduleJobInBackground(jobId);
    }
  }, [jobId, videoCount, smallBatch]);

  useEffect(() => {
    let cancelled = false;
    let pollIndex = 0;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const scheduleNext = (stalled: boolean) => {
      if (cancelled) return;
      const delayMs = scheduleJobPollIntervalMs({
        pollIndex,
        smallBatch,
        hidden: typeof document !== "undefined" && document.hidden,
        stalled,
      });
      pollIndex += 1;
      timeoutId = setTimeout(async () => {
        if (cancelled) return;
        const next = await refresh();
        if (next && isScheduleJobTerminal(next)) return;
        if (next && !shouldPollScheduleJob(next)) return;
        scheduleNext(Boolean(next?.isStalled));
      }, delayMs);
    };

    void refresh().then((next) => {
      if (cancelled || !next) return;
      if (isScheduleJobTerminal(next) || !shouldPollScheduleJob(next)) return;
      scheduleNext(Boolean(next.isStalled));
    });

    const onVisibility = () => {
      if (!document.hidden && !cancelled) {
        void refresh();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [jobId, refresh, smallBatch]);

  const total = status?.total ?? videoCount;
  const banner = status ? statusBanner(status, pollDisplay) : null;
  const isDone = status?.phase === "completed";
  const isPartial = status?.phase === "partial_completed";
  const isBusy = action !== null;
  const showStalledActions = Boolean(status?.isStalled && status.isActive);
  const showResume = Boolean(status?.canResume && !isBusy && !isDone && !showStalledActions);
  const showCompletionBanner = Boolean(banner && !isDone);
  const headline = isDone
    ? "Agendamento concluído"
    : status?.isStalled
      ? "Agendamento travado detectado"
      : (status?.headline ?? "Agendamento em andamento");
  const subheadline = isDone
    ? `${status?.postsSaved ?? 0} de ${total} posts salvos no calendário`
    : isPartial
      ? `${status?.postsSaved ?? 0} de ${total} posts salvos · ${status?.failed ?? 0} com erro`
      : (status?.progressLabel ?? "Preparando agendamento…");

  return (
    <section className="ig-panel space-y-4 p-5">
      <div>
        <p className="text-lg font-semibold text-ig-text">{headline}</p>
        <p className="mt-1 text-sm text-ig-muted">
          {subheadline}
          {!isDone && !isPartial && status && status.failed > 0 ? ` · ${status.failed} com erro` : ""}
        </p>
        {status && !isDone && (
          <div className="mt-2 space-y-1 text-xs text-ig-muted">
            <p>Etapa atual: {status.stepLabel}</p>
            <p>
              Legendas: {status.captionsDone}/{total} · Horários: {status.calendarDone}/{total} ·
              Posts salvos: {status.postsSaved}/{total}
              {status.planChunksTotal > 0 &&
                ` · Chunks: ${status.planChunksDone}/${status.planChunksTotal}`}
            </p>
            <p>Servidor: {status.workerLabel}</p>
          </div>
        )}
      </div>

      {!isDone && (
        <div className="h-2 overflow-hidden rounded-full bg-ig-secondary">
          <div
            className="h-full rounded-full bg-ig-primary transition-all duration-300"
            style={{ width: `${status?.progressPercent ?? 0}%` }}
          />
        </div>
      )}

      {showCompletionBanner && (
        <div
          className={`rounded-xl border px-4 py-3 text-sm ${
            status?.isStalled
              ? "border-ig-danger/40 bg-ig-danger/5 text-ig-text"
              : pollDisplay && pollDisplay.consecutiveFailures >= 2 && status?.isActive
                ? "border-ig-info-border bg-ig-info-bg text-ig-muted"
                : isDone || isPartial
                  ? "border-ig-primary/30 bg-ig-primary/5 text-ig-text"
                  : "border-ig-border bg-ig-secondary/30 text-ig-muted"
          }`}
        >
          {banner}
        </div>
      )}

      {actionError && (
        <div className="rounded-xl border border-ig-danger/40 bg-ig-danger/5 px-4 py-3 text-sm text-ig-danger">
          {actionError}
        </div>
      )}

      <div className="space-y-1">
        {STEP_ORDER.map(({ id, label }) => {
          const stepState = status?.steps[id] ?? (id === "videos" ? "done" : "pending");
          const textClass =
            stepState === "done"
              ? "text-ig-text"
              : stepState === "active"
                ? "text-ig-text font-medium"
                : stepState === "error"
                  ? "text-ig-danger"
                  : "text-ig-muted";

          return (
            <p key={id} className={`flex items-center gap-2 text-sm ${textClass}`}>
              {stepIcon(stepState)}
              {stepState === "done" ? "✓ " : stepState === "active" ? "→ " : ""}
              {label(total, stepState === "done")}
            </p>
          );
        })}
      </div>

      {status?.planSummaryLabel && !isDone && (
        <p className="text-xs text-ig-muted">{status.planSummaryLabel}</p>
      )}
      {status?.postsSummaryLabel && (isDone || isPartial || status.postsSaved > 0) && (
        <p className={`text-xs ${isDone || isPartial ? "text-ig-text" : "text-ig-muted"}`}>
          {status.postsSummaryLabel}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {isDone && onStartNewBatch && accountId ? (
          <BatchCompletionActions
            platform={platform}
            accountId={accountId}
            batchId={batchId}
            onStartNewBatch={onStartNewBatch}
            onViewDetails={() => setShowDetails(true)}
          />
        ) : null}

        {showStalledActions && (
          <>
            {status?.canForceContinue && (
              <button
                type="button"
                disabled={isBusy}
                onClick={() =>
                  void runAction("force", () => forceContinueScheduleJobApi(jobId))
                }
                className="ig-btn-secondary inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold disabled:opacity-50"
              >
                {action === "force" ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <RefreshCw size={16} />
                )}
                Forçar continuação
              </button>
            )}
            {status?.canFinalizePosts && (
              <button
                type="button"
                disabled={isBusy}
                onClick={() =>
                  void runAction("finalize", () => finalizePostsScheduleJobApi(jobId))
                }
                className="ig-btn-primary inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold disabled:opacity-50"
              >
                {action === "finalize" ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <Check size={16} />
                )}
                Finalizar salvamento
              </button>
            )}
            {status?.canResume && (
              <button
                type="button"
                disabled={isBusy}
                onClick={() => void runAction("resume", () => resumeScheduleJobApi(jobId))}
                className="ig-btn-secondary inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold disabled:opacity-50"
              >
                {action === "resume" ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <RefreshCw size={16} />
                )}
                Recuperar job
              </button>
            )}
            {status?.canCancel && (
              <button
                type="button"
                disabled={isBusy}
                onClick={() => {
                  if (!window.confirm("Cancelar este agendamento? Posts já salvos permanecem no calendário.")) {
                    return;
                  }
                  void runAction("cancel", () => cancelScheduleJobApi(jobId));
                }}
                className="ig-btn-secondary inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-ig-danger disabled:opacity-50"
              >
                {action === "cancel" ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <XCircle size={16} />
                )}
                Cancelar job
              </button>
            )}
            <button
              type="button"
              disabled={isBusy}
              onClick={() =>
                void runAction("diagnostics", () => fetchScheduleJobDiagnostics(jobId))
              }
              className="ig-btn-secondary inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold disabled:opacity-50"
            >
              {action === "diagnostics" ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <AlertCircle size={16} />
              )}
              Ver logs
            </button>
          </>
        )}

        {showResume && (
          <button
            type="button"
            onClick={() => void runAction("resume", () => resumeScheduleJobApi(jobId))}
            disabled={isBusy}
            className="ig-btn-secondary inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold disabled:opacity-50"
          >
            <RefreshCw size={16} className={action === "resume" ? "animate-spin" : ""} />
            Recuperar agendamento
          </button>
        )}

        {status?.isActive && !showStalledActions && !showResume && !isDone && (
          <span className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-ig-muted">
            <Loader2 size={16} className="animate-spin" />
            Processando no servidor…
          </span>
        )}

        {!isDone && (status?.canOpenCalendar || isPartial) && (
          <Link
            href={
              accountId
                ? `/dashboard/calendar?${new URLSearchParams({ platform, account: accountId }).toString()}`
                : "/dashboard/calendar"
            }
            className="ig-btn-secondary px-4 py-2 text-sm font-semibold"
          >
            Abrir calendário
          </Link>
        )}

        {!isDone && (
          <button
            type="button"
            onClick={() => setShowDetails((v) => !v)}
            className="ig-btn-secondary inline-flex items-center gap-1 px-4 py-2 text-sm font-semibold"
          >
            {showDetails ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            Ver detalhes
          </button>
        )}
      </div>

      {showDetails && status && (
        <dl className="grid gap-2 rounded-xl border border-ig-border bg-ig-secondary/30 p-3 text-xs text-ig-muted sm:grid-cols-2">
          <div>
            <dt>Job</dt>
            <dd className="font-mono text-ig-text">{status.jobId.slice(0, 8)}…</dd>
          </div>
          <div>
            <dt>Status / fase</dt>
            <dd className="text-ig-text">
              {status.status} · {status.phase}
            </dd>
          </div>
          <div>
            <dt>Servidor</dt>
            <dd className="text-ig-text">{status.workerLabel}</dd>
          </div>
          <div>
            <dt>Atualizado</dt>
            <dd className="text-ig-text">{new Date(status.updatedAt).toLocaleString("pt-BR")}</dd>
          </div>
          {status.lastHeartbeatAt && (
            <div>
              <dt>Último heartbeat</dt>
              <dd className="text-ig-text">
                {new Date(status.lastHeartbeatAt).toLocaleString("pt-BR")}
              </dd>
            </div>
          )}
          {status.lastError && (
            <div className="sm:col-span-2">
              <dt>Último erro</dt>
              <dd className="text-ig-danger">{status.lastError}</dd>
            </div>
          )}
          {status.timing && (
            <>
              <div>
                <dt>Duração total</dt>
                <dd className="text-ig-text">
                  {status.timing.durationMs != null
                    ? `${Math.round(status.timing.durationMs / 1000)}s`
                    : status.timing.queueWaitMs != null
                      ? `fila ${Math.round(status.timing.queueWaitMs / 1000)}s · em andamento`
                      : "—"}
                </dd>
              </div>
              <div>
                <dt>Processamento</dt>
                <dd className="text-ig-text">
                  {status.timing.processingMs != null
                    ? `${Math.round(status.timing.processingMs / 1000)}s`
                    : "—"}
                </dd>
              </div>
            </>
          )}
          {diagnostics && (
            <div className="sm:col-span-2">
              <dt>Diagnóstico</dt>
              <dd className="mt-1 overflow-x-auto rounded-lg bg-ig-secondary p-2 font-mono text-[10px] text-ig-text">
                <pre>{JSON.stringify(diagnostics, null, 2)}</pre>
              </dd>
            </div>
          )}
          <div className="sm:col-span-2">
            <dt>Conexão / polling</dt>
            <dd className="mt-1 overflow-x-auto rounded-lg bg-ig-secondary p-2 font-mono text-[10px] text-ig-text">
              <pre>{JSON.stringify(pollTrackerRef.current.getTechnicalDetails(), null, 2)}</pre>
            </dd>
          </div>
        </dl>
      )}
    </section>
  );
}
