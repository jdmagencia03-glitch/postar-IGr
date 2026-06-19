"use client";

import type { ScheduleInsertionPreview } from "@/lib/schedule-insertion";
import { SCHEDULE_STRATEGY_LABELS } from "@/lib/schedule-insertion";
import { AlertTriangle, CalendarDays } from "lucide-react";

interface Props {
  preview: ScheduleInsertionPreview;
  accountLabel?: string;
  modeLabel?: string;
}

export function ScheduleInsertionOverview({ preview, accountLabel, modeLabel }: Props) {
  return (
    <section className="rounded-xl border border-ig-border bg-ig-secondary p-4">
      <div className="mb-3 flex items-start gap-2">
        <CalendarDays size={16} className="mt-0.5 text-ig-primary" />
        <div>
          <h3 className="text-sm font-semibold text-ig-text">Encaixe inteligente no calendário</h3>
          <p className="mt-1 text-xs text-ig-muted">
            Estratégia: {preview.summaryLabel}
            {preview.continuing ? " · Continuando cronograma atual" : " · Novo plano"}
          </p>
          {accountLabel ? (
            <p className="mt-0.5 text-xs text-ig-muted">
              Conta: @{accountLabel}
              {modeLabel ? ` · Modo: ${modeLabel}` : ""}
            </p>
          ) : null}
        </div>
      </div>

      {preview.warnings.length > 0 ? (
        <div className="mb-3 space-y-1 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2">
          {preview.warnings.map((warning) => (
            <p key={warning} className="flex items-start gap-1.5 text-xs text-amber-200">
              <AlertTriangle size={12} className="mt-0.5 shrink-0" />
              {warning}
            </p>
          ))}
        </div>
      ) : null}

      <div className="space-y-2">
        {preview.days.map((day) => (
          <div
            key={`${day.planDay}-${day.dateLabel}`}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-ig-border bg-ig-elevated px-3 py-2 text-xs"
          >
            <span className="font-medium text-ig-text">
              Dia {day.planDay} — {day.dateLabel}
            </span>
            <span className="text-ig-muted">
              {day.status === "filled"
                ? `${day.existingCount}/${day.dailyLimit} posts preenchidos`
                : day.addingCount > 0
                  ? `${day.existingCount > 0 ? `${day.existingCount}/${day.dailyLimit} preenchidos · ` : ""}adicionando ${day.addingCount} post(s)`
                  : day.existingCount > 0
                    ? `${day.existingCount}/${day.dailyLimit} preenchidos`
                    : ""}
            </span>
          </div>
        ))}
      </div>

      <p className="mt-3 text-[11px] text-ig-muted">
        {SCHEDULE_STRATEGY_LABELS[preview.strategy].description}
      </p>
    </section>
  );
}
