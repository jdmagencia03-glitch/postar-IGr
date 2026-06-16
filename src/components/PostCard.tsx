import type { ScheduledPost } from "@/lib/types";
import { formatDateTime } from "@/lib/utils";
import { extractHashtags } from "@/lib/operations/compute";
import { StatusBadge } from "./StatusBadge";

export function PostCard({
  post,
  hidePermalink = false,
  rich = false,
}: {
  post: ScheduledPost;
  hidePermalink?: boolean;
  rich?: boolean;
}) {
  const username = post.instagram_accounts?.ig_username ?? "conta";
  const hashtags = extractHashtags(post.caption);
  const mediaUrl = post.media_urls[0];

  if (rich) {
    return (
      <div className="overflow-hidden rounded-2xl border border-ig-border bg-ig-elevated">
        <div className="relative aspect-[9/16] max-h-56 bg-ig-secondary">
          {mediaUrl ? (
            mediaUrl.match(/\.(mp4|mov|webm)$/i) ? (
              <video
                src={mediaUrl}
                className="h-full w-full object-cover"
                muted
                playsInline
                preload="metadata"
              />
            ) : (
              <img src={mediaUrl} alt="" className="h-full w-full object-cover" />
            )
          ) : (
            <div className="flex h-full items-center justify-center text-4xl">🎬</div>
          )}
          <div className="absolute left-3 top-3">
            <StatusBadge status={post.status} />
          </div>
        </div>

        <div className="p-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-sm font-medium text-ig-text">@{username}</p>
            <p className="text-xs text-ig-muted">{formatDateTime(post.scheduled_at)}</p>
          </div>
          <p className="line-clamp-3 text-sm text-ig-text">{post.caption || "(sem legenda)"}</p>
          {hashtags.length > 0 && (
            <p className="mt-2 line-clamp-2 text-xs text-ig-link">{hashtags.join(" ")}</p>
          )}
          {post.error_message && (
            <p className="mt-2 text-xs text-ig-danger">{post.error_message}</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="ig-stat p-4">
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
      {post.permalink && !hidePermalink && (
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
