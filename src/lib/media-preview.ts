import type { MediaType } from "@/lib/types";

const VIDEO_EXTENSIONS = /\.(mp4|mov|webm|m4v|quicktime)$/i;

export function isVideoUrl(url: string | undefined | null) {
  if (!url) return false;
  const path = url.split("?")[0].split("#")[0];
  return VIDEO_EXTENSIONS.test(path);
}

export function isVideoPost(mediaType: MediaType, mediaUrl: string | undefined) {
  if (mediaType === "REELS") return true;
  if (mediaType === "IMAGE") return false;
  return isVideoUrl(mediaUrl);
}

export function videoPreviewSrc(url: string) {
  const base = url.split("#")[0];
  return `${base}#t=0.1`;
}
