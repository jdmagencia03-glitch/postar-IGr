"use client";

import { useState } from "react";
import { StatusBadge } from "@/components/StatusBadge";
import { formatInAppTimezone } from "@/lib/timezone";
import type { ScheduledPost } from "@/lib/types";
import { cn } from "@/lib/utils";

type Props = {
  posts: ScheduledPost[];
  isPublishedDay: boolean;
  initialVisible?: number;
};

export function CalendarDayPosts({
  posts,
  isPublishedDay,
  initialVisible = 6,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? posts : posts.slice(0, initialVisible);
  const hidden = posts.length - initialVisible;

  return (
    <div className="space-y-1">
      {visible.map((p) => (
        <div key={p.id} className="flex items-center justify-between gap-2">
          <span
            className={cn(
              "inline-flex items-center gap-1 text-xs",
              isPublishedDay ? "text-ig-on-primary" : "text-ig-muted",
            )}
          >
            <span
              className={cn(
                "rounded px-1 text-[10px] font-semibold uppercase",
                isPublishedDay
                  ? "bg-ig-on-primary/20 text-ig-on-primary"
                  : p.platform === "tiktok"
                    ? "bg-black/10 text-ig-text"
                    : "bg-ig-primary/10 text-ig-primary",
              )}
            >
              {p.platform === "tiktok" ? "TT" : "IG"}
            </span>
            {formatInAppTimezone(p.scheduled_at, { hour: "2-digit", minute: "2-digit" })}
          </span>
          <StatusBadge status={p.status} onPrimary={isPublishedDay} />
        </div>
      ))}
      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className={cn(
            "text-left text-xs font-medium underline-offset-2 hover:underline",
            isPublishedDay ? "text-ig-on-primary/90" : "text-ig-primary",
          )}
        >
          {expanded ? "Ver menos" : `Ver mais (+${hidden})`}
        </button>
      )}
    </div>
  );
}
