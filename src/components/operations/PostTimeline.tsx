"use client";

import type { PostTimelineEvent } from "@/lib/operations/post-timeline";
import { formatDateTime } from "@/lib/utils";

interface Props {
  events: PostTimelineEvent[];
}

const toneClass: Record<PostTimelineEvent["tone"], string> = {
  info: "border-ig-border bg-ig-secondary",
  success: "border-emerald-500/30 bg-emerald-500/5",
  error: "border-ig-danger/30 bg-ig-danger/5",
  warning: "border-amber-500/30 bg-amber-500/5",
};

export function PostTimeline({ events }: Props) {
  if (!events.length) {
    return <p className="text-sm text-ig-muted">Nenhum evento registrado.</p>;
  }

  return (
    <ol className="space-y-3">
      {events.map((event) => (
        <li
          key={event.id}
          className={`rounded-xl border p-3 ${toneClass[event.tone]}`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium text-ig-text">{event.label}</p>
            <span className="text-xs text-ig-muted">{formatDateTime(event.at)}</span>
          </div>
          {event.detail && <p className="mt-1 text-xs text-ig-muted">{event.detail}</p>}
        </li>
      ))}
    </ol>
  );
}
