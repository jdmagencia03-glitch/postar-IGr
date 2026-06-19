"use client";

import type { WarmupDayBreakdown } from "@/lib/account-warmup";
import {
  WARMUP_MODE_EXPANDED_DESCRIPTION,
  describeWarmupDayPlan,
} from "@/lib/account-warmup";

interface ScheduledDay {
  day: number;
  dateLabel?: string;
  posts: number;
  times: string[];
}

interface Props {
  /** Cronograma gerado (com datas reais). Se omitido, mostra o plano padrão Dia 1–5. */
  scheduledDays?: ScheduledDay[];
  title?: string;
  showExpandedDescription?: boolean;
}

export function WarmupScheduleOverview({
  scheduledDays,
  title = "🛡️ Cronograma de aquecimento",
  showExpandedDescription = true,
}: Props) {
  const days = scheduledDays?.length ? scheduledDays : describeWarmupDayPlan();

  return (
    <div className="rounded-xl border border-ig-info-border bg-ig-info-bg px-4 py-3 text-sm">
      <p className="font-semibold text-ig-text">{title}</p>
      {showExpandedDescription && (
        <p className="mt-1 text-xs text-ig-muted">{WARMUP_MODE_EXPANDED_DESCRIPTION}</p>
      )}
      <ul className="mt-3 space-y-2">
        {days.map((entry) => (
          <li key={entry.day} className="text-xs text-ig-text">
            <span className="font-medium">
              Dia {entry.day}
              {"dateLabel" in entry && entry.dateLabel ? ` (${entry.dateLabel})` : ""} — {entry.posts}{" "}
              {entry.posts === 1 ? "post" : "posts"}
            </span>
            <p className="mt-0.5 text-ig-muted">{entry.times.join(", ")}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
