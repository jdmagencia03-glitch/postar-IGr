import { ExpandableCaption } from "@/components/ExpandableCaption";
import { MediaPreview } from "@/components/MediaPreview";
import { getPostAccountUsername } from "@/lib/posts";
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
  const username = getPostAccountUsername(post);
  const platformLabel = post.platform === "tiktok" ? "TikTok" : "Instagram";
  const hashtags = extractHashtags(post.caption);
  const mediaUrl = post.media_urls[0];

  if (rich) {
    return (
      <div className="overflow-hidden rounded-2xl border border-ig-border bg-ig-elevated">
        <div className="relative aspect-[9/16] max-h-56 bg-ig-secondary">
          <MediaPreview mediaType={post.media_type} mediaUrl={mediaUrl} />
          <div className="absolute left-3 top-3">
            <StatusBadge status={post.status} />
          </div>
        </div>

        <div className="p-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-sm font-medium text-ig-text">
              {post.platform === "tiktok" ? "TT" : "IG"} @{username}
            </p>
            <p className="text-xs text-ig-muted">{formatDateTime(post.scheduled_at)}</p>
          </div>
          <ExpandableCaption text={post.caption ?? ""} maxLines={4} />
          {hashtags.length > 0 && (
            <ExpandableCaption
              text={hashtags.join(" ")}
              maxLines={2}
              className="mt-2 [&_p]:text-xs [&_p]:text-ig-link"
            />
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
          <p className="text-sm font-medium text-ig-text">
            {post.platform === "tiktok" ? "TT" : "IG"} @{username}
          </p>
          <p className="text-xs text-ig-muted">{formatDateTime(post.scheduled_at)}</p>
        </div>
        <StatusBadge status={post.status} />
      </div>
      <p className="mb-2 text-xs uppercase tracking-wide text-ig-link">{post.media_type}</p>
      <ExpandableCaption text={post.caption ?? ""} maxLines={2} />
      {post.permalink && !hidePermalink && (
        <a
          href={post.permalink}
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-block text-xs text-ig-primary hover:underline"
        >
          Ver no {platformLabel}
        </a>
      )}
      {post.error_message && (
        <p className="mt-2 text-xs text-ig-danger">{post.error_message}</p>
      )}
    </div>
  );
}
