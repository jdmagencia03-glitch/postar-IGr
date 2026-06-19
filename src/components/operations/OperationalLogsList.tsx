"use client";

import Link from "next/link";
import { formatDateTime } from "@/lib/utils";
import {
  inferOperationalEventType,
  operationalEventLabel,
} from "@/lib/operations/post-timeline";
import { getPostAccountUsername } from "@/lib/posts";
import type { PublishLog, ScheduledPost } from "@/lib/types";

export interface OperationalLogRow {
  id: string;
  eventType: string;
  eventLabel: string;
  accountUsername: string;
  platform: string;
  postId: string;
  message: string;
  level: string;
  createdAt: string;
}

interface Props {
  rows: OperationalLogRow[];
  errorMessage?: string;
}

export function buildOperationalLogRows(
  logs: PublishLog[],
  postsById: Map<string, ScheduledPost>,
): OperationalLogRow[] {
  return logs.map((log) => {
    const post = postsById.get(log.post_id);
    const message = log.message ?? "";
    const eventType = inferOperationalEventType(message);

    return {
      id: log.id,
      eventType,
      eventLabel: operationalEventLabel(eventType),
      accountUsername: post ? getPostAccountUsername(post) : "—",
      platform: post?.platform ?? "—",
      postId: log.post_id,
      message,
      level: log.level,
      createdAt: log.created_at,
    };
  });
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
