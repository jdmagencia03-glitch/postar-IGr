"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";

export type CalendarView = "active" | "all" | "pending" | "published" | "cancelled";

const VIEWS: Array<{ id: CalendarView; label: string }> = [
  { id: "active", label: "Pendentes" },
  { id: "published", label: "Publicados" },
  { id: "cancelled", label: "Cancelados" },
  { id: "all", label: "Todos" },
];

type Props = {
  currentView: CalendarView;
  basePath: string;
  extraParams: Record<string, string | undefined>;
};

export function CalendarStatusFilter({ currentView, basePath, extraParams }: Props) {
  function hrefFor(view: CalendarView) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(extraParams)) {
      if (value) query.set(key, value);
    }
    if (view !== "active") query.set("view", view);
    const qs = query.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  }

  return (
    <div className="mb-4 flex flex-wrap gap-2">
      {VIEWS.map((view) => (
        <Link
          key={view.id}
          href={hrefFor(view.id)}
          className={cn(
            "rounded-full px-3 py-1.5 text-sm font-medium transition",
            currentView === view.id
              ? "bg-ig-primary text-ig-on-primary"
              : "border border-ig-border bg-ig-elevated text-ig-muted hover:bg-ig-secondary",
          )}
        >
          {view.label}
        </Link>
      ))}
    </div>
  );
}
