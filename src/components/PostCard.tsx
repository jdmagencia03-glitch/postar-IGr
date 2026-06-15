import type { ScheduledPost } from "@/lib/types";
import { formatDateTime } from "@/lib/utils";
import { StatusBadge } from "./StatusBadge";

export function PostCard({ post }: { post: ScheduledPost }) {
  const username = post.instagram_accounts?.ig_username ?? "conta";

  return (
    <div className="rounded-xl border border-ig-border bg-ig-secondary p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-ig-text">@{username}</p>
          <p className="text-xs text-ig-muted">{formatDateTime(post.scheduled_at)}</p>
        </div>
        <StatusBadge status={post.status} />
      </div>
      <p className="mb-2 text-xs uppercase tracking-wide text-ig-link">{post.media_type}</p>
      <p className="line-clamp-2 text-sm text-ig-text">
        {post.caption || "(sem legenda)"}
      </p>
      {post.permalink && (
        <a
          href={post.permalink}
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-block text-xs text-ig-primary hover:underline"
        >
          Ver no Instagram
        </a>
      )}
      {post.error_message && (
        <p className="mt-2 text-xs text-ig-danger">{post.error_message}</p>
      )}
    </div>
  );
}
