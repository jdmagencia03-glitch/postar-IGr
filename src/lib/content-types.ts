import type { MediaType, ScheduledPost } from "@/lib/types";

export const CONTENT_TYPES = [
  "reel",
  "post",
  "story",
  "tiktok_video",
  "youtube_short",
] as const;

export type ContentType = (typeof CONTENT_TYPES)[number];

export const CONTENT_TYPE_LABELS: Record<ContentType, string> = {
  reel: "Reel",
  post: "Post",
  story: "Story",
  tiktok_video: "TikTok",
  youtube_short: "YouTube Short",
};

export function contentTypeFromMediaType(mediaType: MediaType): ContentType {
  switch (mediaType) {
    case "IMAGE":
    case "CAROUSEL":
      return "post";
    default:
      return "reel";
  }
}

export function isStoryPost(post: Pick<ScheduledPost, "content_type">) {
  return post.content_type === "story";
}

export function mediaTypeForStoryFile(filename: string, mimeType?: string): MediaType {
  const isVideo =
    mimeType?.startsWith("video/") || /\.(mp4|mov|webm)$/i.test(filename);
  return isVideo ? "REELS" : "IMAGE";
}

export function defaultInsertContentType(mediaType: MediaType): ContentType {
  return contentTypeFromMediaType(mediaType);
}

export function contentTypeForPlatform(platform: "instagram" | "tiktok"): ContentType {
  return platform === "tiktok" ? "tiktok_video" : "reel";
}
