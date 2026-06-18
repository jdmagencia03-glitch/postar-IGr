"use client";

import type { OperationsAlert } from "@/lib/operations/alerts-engine";

interface Props {
  alerts: OperationsAlert[];
}

export function OperationsAlertsPanel({ alerts }: Props) {
  if (!alerts.length) return null;

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold text-ig-text">Alertas operacionais</h2>
      {alerts.map((alert) => (
        <div
          key={alert.id}
          className={`rounded-2xl border px-5 py-4 ${
            alert.tone === "danger"
              ? "border-ig-danger/30 bg-ig-danger/10"
              : alert.tone === "warning"
                ? "border-amber-500/30 bg-amber-500/10"
                : "border-ig-info-border bg-ig-info-bg"
          }`}
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-semibold text-ig-text">
                {alert.severity === "critical" ? "🔴" : alert.severity === "warning" ? "🟡" : "🔵"}{" "}
                {alert.title}
              </p>
              <p className="mt-1 text-sm text-ig-muted">{alert.message}</p>
              {alert.accountUsername && (
                <p className="mt-1 text-xs text-ig-muted">Conta: @{alert.accountUsername}</p>
              )}
            </div>
            {alert.actionHref && alert.actionLabel && (
              <a
                href={alert.actionHref}
                className="shrink-0 text-sm font-medium text-ig-primary hover:underline"
              >
                {alert.actionLabel}
              </a>
            )}
          </div>
        </div>
      ))}
    </section>
  );
}
