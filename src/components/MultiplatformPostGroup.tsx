"use client";

import { Layers } from "lucide-react";
import { ScheduledPostCard } from "@/components/ScheduledPostCard";
import { publishGroupLabel } from "@/lib/operations/group-posts";
import { formatDateTime } from "@/lib/utils";
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

  return (
    <div className="rounded-2xl border border-ig-primary/30 bg-ig-elevated sm:col-span-2 lg:col-span-3">
      <div className="border-b border-ig-border bg-ig-secondary/60 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <Layers className="h-4 w-4 text-ig-primary" />
          <p className="text-sm font-semibold text-ig-text">{title}</p>
          <span className="rounded-full bg-ig-primary/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-ig-primary">
            Multiplataforma
          </span>
        </div>
        <p className="mt-1 text-xs text-ig-muted">
          Mesmo vídeo em {posts.length} destino(s) — status, erro e retry independentes
        </p>
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
