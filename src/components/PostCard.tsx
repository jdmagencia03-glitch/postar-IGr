import { ExpandableCaption } from "@/components/ExpandableCaption";
import { MediaPreview } from "@/components/MediaPreview";
import { CONTENT_TYPE_LABELS } from "@/lib/content-types";
import { getPostAccountUsername } from "@/lib/posts";
import type { ScheduledPost } from "@/lib/types";
import { formatDateTime } from "@/lib/utils";
import { extractHashtags } from "@/lib/operations/compute";
import { StatusBadge } from "./StatusBadge";

function contentTypeLabel(post: ScheduledPost) {
  const type = post.content_type ?? "reel";
  return CONTENT_TYPE_LABELS[type] ?? type;
}

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
  const isStory = post.content_type === "story";
  const displayText = post.caption ?? "";

  if (rich) {
    return (
      <div className="overflow-hidden rounded-2xl border border-ig-border bg-ig-elevated">
        <div className="relative aspect-[9/16] max-h-56 bg-ig-secondary">
          <MediaPreview mediaType={post.media_type} mediaUrl={mediaUrl} />
          <div className="absolute left-3 top-3 flex flex-wrap gap-2">
            <StatusBadge status={post.status} />
            <span className="rounded-full bg-black/50 px-2 py-1 text-[10px] font-medium text-white">
              {contentTypeLabel(post)}
            </span>
          </div>
        </div>

        <div className="p-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-sm font-medium text-ig-text">
              {post.platform === "tiktok" ? "TT" : "IG"} @{username}
            </p>
            <p className="text-xs text-ig-muted">{formatDateTime(post.scheduled_at)}</p>
          </div>
          <ExpandableCaption text={displayText} maxLines={4} />
          {isStory && post.story_cta && (
            <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-ig-primary">
              CTA: {post.story_cta}
            </p>
          )}
          {isStory && post.publish_block_reason && post.status === "pending" && (
            <p className="mt-2 text-xs text-amber-600">{post.publish_block_reason}</p>
          )}
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
        <div className="flex flex-col items-end gap-1">
          <StatusBadge status={post.status} />
          <span className="text-[10px] font-medium uppercase tracking-wide text-ig-muted">
            {contentTypeLabel(post)}
          </span>
        </div>
      </div>
      <p className="mb-2 text-xs uppercase tracking-wide text-ig-link">
        {isStory ? "Story" : post.media_type}
      </p>
      <ExpandableCaption text={displayText} maxLines={2} />
      {isStory && post.story_cta && (
        <p className="mt-2 text-xs font-semibold text-ig-primary">CTA: {post.story_cta}</p>
      )}
      {isStory && post.publish_block_reason && post.status === "pending" && (
        <p className="mt-2 text-xs text-amber-600">{post.publish_block_reason}</p>
      )}
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
