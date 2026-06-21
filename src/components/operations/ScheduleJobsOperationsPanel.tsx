"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, RefreshCw } from "lucide-react";

type JobRow = {
  id: string;
  status: string;
  current_step: string;
  total_items: number;
  processed_items: number;
  completed_items: number;
  failed_items: number;
  schedule_summary: string | null;
  error_message: string | null;
  updated_at: string;
  upload_batch_id: string | null;
};

type Health = {
  ok: boolean;
  worker: string;
  dispatcher: string;
  queuedJobs: number;
  processingJobs: number;
  stuckJobs: number;
  failedJobs: number;
  queue: Record<string, number>;
};

export function ScheduleJobsOperationsPanel() {
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [health, setHealth] = useState<Health | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [jobsRes, healthRes] = await Promise.all([
        fetch("/api/operations/schedule-jobs"),
        fetch("/api/health/schedule-jobs"),
      ]);
      const jobsData = await jobsRes.json();
      const healthData = await healthRes.json();
      if (jobsRes.ok) setJobs((jobsData.jobs as JobRow[]) ?? []);
      if (healthRes.ok) setHealth(healthData as Health);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 10000);
    return () => window.clearInterval(id);
  }, [load]);

  async function runAction(action: string, jobId?: string) {
    setActing(jobId ?? action);
    try {
      await fetch("/api/operations/schedule-jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, jobId }),
      });
      await load();
    } finally {
      setActing(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-ig-text">Jobs de Agendamento</h1>
          <p className="text-sm text-ig-muted">
            Fila profissional — legendas, calendário e salvamento em background.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="ig-btn-secondary inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold"
        >
          <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
          Atualizar
        </button>
      </div>

      {health && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="Worker" value={health.worker} />
          <Metric label="Dispatcher" value={health.dispatcher} />
          <Metric label="Processando" value={String(health.processingJobs)} />
          <Metric label="Travados" value={String(health.stuckJobs)} />
          <Metric label="Fila (tasks pending)" value={String(health.queue.pending ?? 0)} />
          <Metric label="Tasks processing" value={String(health.queue.processing ?? 0)} />
          <Metric label="Jobs na fila" value={String(health.queuedJobs)} />
          <Metric label="Jobs falhos" value={String(health.failedJobs)} />
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-ig-border">
        <table className="min-w-full text-sm">
          <thead className="bg-ig-secondary/40 text-left text-ig-muted">
            <tr>
              <th className="px-4 py-3">Job</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Progresso</th>
              <th className="px-4 py-3">Etapa</th>
              <th className="px-4 py-3">Atualizado</th>
              <th className="px-4 py-3">Ações</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => (
              <tr key={job.id} className="border-t border-ig-border">
                <td className="px-4 py-3 font-mono text-xs">{job.id.slice(0, 8)}…</td>
                <td className="px-4 py-3">{job.status}</td>
                <td className="px-4 py-3">
                  {job.completed_items}/{job.total_items} salvos · {job.processed_items} plano
                </td>
                <td className="px-4 py-3">{job.current_step}</td>
                <td className="px-4 py-3">{new Date(job.updated_at).toLocaleString("pt-BR")}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={acting === job.id}
                      onClick={() => void runAction("recover_job", job.id)}
                      className="ig-btn-secondary px-2 py-1 text-xs"
                    >
                      Recuperar
                    </button>
                    <button
                      type="button"
                      disabled={acting === job.id}
                      onClick={() => void runAction("cancel_job", job.id)}
                      className="ig-btn-secondary px-2 py-1 text-xs"
                    >
                      Cancelar
                    </button>
                    <Link href="/dashboard/calendar" className="ig-btn-secondary px-2 py-1 text-xs">
                      Calendário
                    </Link>
                  </div>
                </td>
              </tr>
            ))}
            {!jobs.length && !loading && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-ig-muted">
                  Nenhum job recente.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {loading && (
          <p className="flex items-center justify-center gap-2 py-6 text-sm text-ig-muted">
            <Loader2 size={16} className="animate-spin" /> Carregando…
          </p>
        )}
      </div>

      <button
        type="button"
        disabled={acting === "recover_stuck"}
        onClick={() => void runAction("recover_stuck")}
        className="ig-btn-secondary px-4 py-2 text-sm font-semibold"
      >
        Recuperar todos os jobs travados
      </button>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-ig-border bg-ig-secondary/20 p-4">
      <p className="text-xs text-ig-muted">{label}</p>
      <p className="mt-1 text-lg font-semibold text-ig-text">{value}</p>
    </div>
  );
}
