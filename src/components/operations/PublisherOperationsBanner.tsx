"use client";

import { useEffect, useState } from "react";
import { Activity, AlertTriangle, CheckCircle2 } from "lucide-react";
import { formatShortDateTime } from "@/lib/operations/compute";

interface HealthResponse {
  cron_configured: boolean;
  overdue_pending: number;
  stuck_processing: number;
  retrying: number;
  failed_persistent: number;
  pending: number;
  last_publish_at: string | null;
  cron_stale: boolean;
  status: "healthy" | "attention" | "critical";
  healthy: boolean;
}

function minutesAgo(iso: string | null) {
  if (!iso) return null;
  const diff = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (diff < 1) return "agora";
  if (diff < 60) return `há ${diff} min`;
  return formatShortDateTime(iso);
}

export function PublisherOperationsBanner() {
  const [health, setHealth] = useState<HealthResponse | null>(null);

  useEffect(() => {
    fetch("/api/health/publisher", { credentials: "include", cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then(setHealth)
      .catch(() => setHealth(null));
  }, []);

  if (!health) return null;

  const Icon =
    health.status === "healthy"
      ? CheckCircle2
      : health.status === "attention"
        ? Activity
        : AlertTriangle;

  const tone =
    health.status === "healthy"
      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-100"
      : health.status === "attention"
        ? "border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-100"
        : "border-ig-danger/30 bg-ig-danger/10 text-ig-danger";

  let headline = "Publicador saudável";
  if (health.status === "attention") headline = "Publicador em atenção";
  if (health.status === "critical") headline = "Publicador crítico";

  let detail = "";
  if (!health.cron_configured) {
    detail = "CRON_SECRET não configurado — publicações automáticas podem falhar.";
  } else if (health.stuck_processing > 0) {
    detail = `${health.stuck_processing} publicação(ões) presa(s) em publishing.`;
  } else if (health.retrying > 0) {
    detail = `${health.retrying} publicação(ões) em retry.`;
  } else if (health.overdue_pending > 0) {
    detail = `${health.overdue_pending} post(s) atrasados na fila.`;
  } else if (health.last_publish_at) {
    detail = `Última publicação ${minutesAgo(health.last_publish_at)}.`;
  } else {
    detail = "Nenhuma publicação registrada recentemente.";
  }

  return (
    <div className={`flex flex-wrap items-start gap-3 rounded-2xl border p-4 text-sm ${tone}`}>
      <Icon className="mt-0.5 h-5 w-5 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{headline}</p>
        <p className="mt-1 opacity-90">{detail}</p>
        <p className="mt-2 text-xs opacity-80">
          Pendentes: {health.pending} · Retry: {health.retrying} · Falha persistente:{" "}
          {health.failed_persistent}
          {health.cron_stale ? " · Cron pode estar parado" : ""}
        </p>
      </div>
    </div>
  );
}
