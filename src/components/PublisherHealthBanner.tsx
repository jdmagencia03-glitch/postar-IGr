"use client";

import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { fetchWithTimeout } from "@/lib/client-fetch-timeout";

interface HealthResponse {
  cron_configured: boolean;
  overdue_pending: number;
  stuck_processing: number;
  healthy: boolean;
}

export function PublisherHealthBanner() {
  const [health, setHealth] = useState<HealthResponse | null>(null);

  useEffect(() => {
    fetchWithTimeout("/api/health/publisher", { credentials: "include", cache: "no-store" }, 3_000)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setHealth(data))
      .catch(() => setHealth(null));
  }, []);

  if (!health || health.healthy) return null;

  let message = "";
  if (!health.cron_configured) {
    message =
      "O publicador automático não está configurado (CRON_SECRET). Posts agendados podem não ser publicados no horário.";
  } else if (health.stuck_processing > 0) {
    message = `${health.stuck_processing} post(s) preso(s) em “Publicando”. Use “Tentar novamente” na Central de Operações.`;
  } else if (health.overdue_pending > 0) {
    message = `${health.overdue_pending} post(s) passaram do horário e ainda estão pendentes. Verifique o cron de publicação.`;
  }

  if (!message) return null;

  return (
    <div className="mb-6 flex items-start gap-3 rounded-xl border border-ig-danger/30 bg-ig-danger/10 px-4 py-3 text-sm text-ig-danger">
      <AlertTriangle size={18} className="mt-0.5 shrink-0" />
      <p>{message}</p>
    </div>
  );
}
