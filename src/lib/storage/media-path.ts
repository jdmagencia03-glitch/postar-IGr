import { buildBunnyCdnUrl, parseBunnyCdnStoragePath } from "@/lib/storage/bunny";
import {
  bunnyStreamStorageKey,
  getBunnyStreamConfig,
  isBunnyStreamMediaUrl,
  parseBunnyStreamStorageKey,
  parseBunnyStreamVideoIdFromUrl,
} from "@/lib/storage/bunny-stream";

export const MEDIA_BUCKET = "media";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Extrai o path do bucket `media` a partir da URL pública legada do Supabase. */
export function parseSupabaseMediaStoragePath(url: string): string | null {
  try {
    const pathname = new URL(url).pathname;
    const marker = `/storage/v1/object/public/${MEDIA_BUCKET}/`;
    const index = pathname.indexOf(marker);
    if (index === -1) return null;
    return decodeURIComponent(pathname.slice(index + marker.length));
  } catch {
    return null;
  }
}

export function parseMediaStoragePathFromUrl(url: string): string | null {
  const streamVideoId = parseBunnyStreamVideoIdFromUrl(url);
  if (streamVideoId) return bunnyStreamStorageKey(streamVideoId);
  return parseBunnyCdnStoragePath(url) ?? parseSupabaseMediaStoragePath(url);
}

export function buildBunnyStreamPublicUrl(videoId: string) {
  const config = getBunnyStreamConfig();
  if (!config) return null;
  return `https://${config.cdnHostname}/${videoId}/original`;
}

export function buildSupabasePublicMediaUrl(storagePath: string) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) return null;
  return `${supabaseUrl.replace(/\/$/, "")}/storage/v1/object/public/${MEDIA_BUCKET}/${storagePath}`;
}

export function buildPublicMediaUrl(storagePath: string) {
  const streamVideoId = parseBunnyStreamStorageKey(storagePath);
  if (streamVideoId) return buildBunnyStreamPublicUrl(streamVideoId);
  return buildBunnyCdnUrl(storagePath) ?? buildSupabasePublicMediaUrl(storagePath);
}

export function buildAllPublicMediaUrls(storagePath: string) {
  const urls = new Set<string>();
  const streamVideoId = parseBunnyStreamStorageKey(storagePath);
  if (streamVideoId) {
    const streamUrl = buildBunnyStreamPublicUrl(streamVideoId);
    if (streamUrl) urls.add(streamUrl);
    const playUrl = getBunnyStreamConfig()
      ? `https://${getBunnyStreamConfig()!.cdnHostname}/${streamVideoId}/play_720p.mp4`
      : null;
    if (playUrl) urls.add(playUrl);
  }
  const bunny = buildBunnyCdnUrl(storagePath);
  const supabase = buildSupabasePublicMediaUrl(storagePath);
  if (bunny) urls.add(bunny);
  if (supabase) urls.add(supabase);
  return [...urls];
}

export { parseBunnyStreamStorageKey } from "@/lib/storage/bunny-stream";
export { isBunnyStreamMediaUrl };

export type ParsedMediaPath = {
  storageObjectPathFromUrl: string | null;
  fileName: string | null;
  ownerIdFromPath: string | null;
  batchIdFromPath: string | null;
  uploadFileIdFromPath: string | null;
};

export function parseStoragePathSegments(storagePath: string | null): ParsedMediaPath {
  const fileName = storagePath?.split("/").pop() ?? null;
  const segments = storagePath?.split("/") ?? [];

  const ownerIdFromPath = segments[0] ?? null;
  const batchIdFromPath = segments[1] && UUID_RE.test(segments[1]) ? segments[1] : null;
  const uploadFileIdFromPath =
    fileName && UUID_RE.test(fileName.replace(/\.[^.]+$/, ""))
      ? fileName.replace(/\.[^.]+$/, "")
      : null;

  return {
    storageObjectPathFromUrl: storagePath,
    fileName,
    ownerIdFromPath,
    batchIdFromPath,
    uploadFileIdFromPath,
  };
}

export function parseMediaPublicUrl(videoUrl: string) {
  const storageObjectPathFromUrl = parseMediaStoragePathFromUrl(videoUrl);
  return {
    videoUrl,
    storageBucket: MEDIA_BUCKET,
    ...parseStoragePathSegments(storageObjectPathFromUrl),
  };
}
