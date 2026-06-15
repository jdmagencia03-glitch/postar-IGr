import type { ScheduledPost } from "@/lib/types";
import { formatDateTime } from "@/lib/utils";
import { StatusBadge } from "./StatusBadge";

export function PostCard({ post }: { post: ScheduledPost }) {
  const username = post.instagram_accounts?.ig_username ?? "conta";

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-white">@{username}</p>
          <p className="text-xs text-zinc-400">{formatDateTime(post.scheduled_at)}</p>
        </div>
        <StatusBadge status={post.status} />
      </div>
      <p className="mb-2 text-xs uppercase tracking-wide text-pink-300">{post.media_type}</p>
      <p className="line-clamp-2 text-sm text-zinc-300">
        {post.caption || "(sem legenda)"}
      </p>
      {post.permalink && (
        <a
          href={post.permalink}
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-block text-xs text-pink-400 hover:underline"
        >
          Ver no Instagram
        </a>
      )}
      {post.error_message && (
        <p className="mt-2 text-xs text-red-400">{post.error_message}</p>
      )}
    </div>
  );
}
