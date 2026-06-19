"use client";

import Link from "next/link";
import type { OperationalLogRow } from "@/lib/operations/operational-logs";
import { formatDateTime } from "@/lib/utils";

export type { OperationalLogRow } from "@/lib/operations/operational-logs";

interface Props {
  rows: OperationalLogRow[];
  errorMessage?: string;
}

const levelColors = {
  info: "text-ig-link",
  success: "text-emerald-600",
  error: "text-ig-danger",
};

export function OperationalLogsList({ rows, errorMessage }: Props) {
  return (
    <div>
      {errorMessage && (
        <div className="mb-4 rounded-xl border border-ig-danger/30 bg-ig-danger/10 px-4 py-3 text-sm text-ig-danger">
          {errorMessage}
        </div>
      )}
      <div className="divide-y divide-ig-border overflow-hidden rounded-2xl border border-ig-border">
        {rows.map((row) => (
          <div key={row.id} className="px-4 py-3">
            <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-ig-secondary px-2 py-0.5 text-[10px] font-medium uppercase text-ig-muted">
                  {row.eventLabel}
                </span>
                <span
                  className={`text-xs font-medium uppercase ${levelColors[row.level as keyof typeof levelColors] ?? "text-ig-muted"}`}
                >
                  {row.level}
                </span>
              </div>
              <span className="text-xs text-ig-muted">{formatDateTime(row.createdAt)}</span>
            </div>
            <p className="text-sm text-ig-text">{row.message}</p>
            <p className="mt-1 text-xs text-ig-muted">
              @{row.accountUsername} · {row.platform}
              {" · "}
              <Link href={`/dashboard/posts/${row.postId}`} className="text-ig-primary hover:underline">
                Ver publicação
              </Link>
            </p>
          </div>
        ))}
        {!rows.length && !errorMessage && (
          <p className="px-4 py-12 text-center text-sm text-ig-muted">
            Sem logs ainda. As ações importantes da plataforma aparecerão aqui.
          </p>
        )}
        {!rows.length && errorMessage && (
          <p className="px-4 py-12 text-center text-sm text-ig-muted">
            Nenhum log disponível no momento.
          </p>
        )}
      </div>
    </div>
  );
}
