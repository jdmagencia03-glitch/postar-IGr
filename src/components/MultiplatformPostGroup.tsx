"use client";

import Link from "next/link";
import { Layers } from "lucide-react";
import { ScheduledPostCard } from "@/components/ScheduledPostCard";
import { publishGroupLabel } from "@/lib/operations/group-posts";
import {
  destinationLabel,
  publishGroupStatusClass,
  summarizePublishGroup,
} from "@/lib/operations/group-status";
import { formatDateTime } from "@/lib/utils";
import { StatusBadge } from "@/components/StatusBadge";
import type { ScheduledPost } from "@/lib/types";

interface Props {
  groupId: string;
  posts: ScheduledPost[];
  index: number;
  selectable?: boolean;
  selectedIds?: string[];
  onSelect?: (postId: string, selected: boolean) => void;
  onUpdated?: () => void;
  rich?: boolean;
  showPublishedMeta?: boolean;
}

export function MultiplatformPostGroup({
  groupId,
  posts,
  index,
  selectable = false,
  selectedIds = [],
  onSelect,
  onUpdated,
  rich = false,
  showPublishedMeta = false,
}: Props) {
  const title = publishGroupLabel(posts, index);
  const summary = summarizePublishGroup(groupId, posts);

  return (
    <div className="rounded-2xl border border-ig-primary/30 bg-ig-elevated sm:col-span-2 lg:col-span-3">
      <div className="border-b border-ig-border bg-ig-secondary/60 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Layers className="h-4 w-4 text-ig-primary" />
            <p className="text-sm font-semibold text-ig-text">{title}</p>
            <span className="rounded-full bg-ig-primary/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-ig-primary">
              Multiplataforma
            </span>
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${publishGroupStatusClass(summary.status)}`}
            >
              {summary.statusLabel}
            </span>
          </div>
          <p className="text-xs text-ig-muted">
            {summary.destinationCount} destino(s) · {summary.publishedCount} publicados
            {summary.failedCount > 0 && ` · ${summary.failedCount} com erro`}
          </p>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {posts.map((post) => (
            <div
              key={post.id}
              className="flex items-center gap-2 rounded-lg border border-ig-border bg-ig-elevated px-2 py-1 text-xs"
            >
              <span className="font-medium text-ig-text">{destinationLabel(post)}</span>
              <StatusBadge status={post.status} />
              <span className="text-ig-muted">{formatDateTime(post.scheduled_at)}</span>
              {post.error_message && (
                <span className="max-w-[140px] truncate text-ig-danger">{post.error_message}</span>
              )}
              <Link href={`/dashboard/posts/${post.id}`} className="text-ig-primary hover:underline">
                Detalhes
              </Link>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-4 p-4 sm:grid-cols-2">
        {posts.map((post) => (
          <ScheduledPostCard
            key={post.id}
            post={post}
            selectable={selectable}
            selected={selectedIds.includes(post.id)}
            onSelect={(selected) => onSelect?.(post.id, selected)}
            onUpdated={onUpdated}
            rich={rich}
            publishedMeta={
              showPublishedMeta && post.status === "published" && post.published_at
                ? `Publicado em ${formatDateTime(post.published_at)}`
                : null
            }
          />
        ))}
      </div>
    </div>
  );
}
