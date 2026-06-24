import { createHash } from "crypto";

export const BUNNY_STREAM_API_BASE = "https://video.bunnycdn.com";
export const BUNNY_STREAM_TUS_ENDPOINT = "https://video.bunnycdn.com/tusupload";

const VIDEO_GUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Status codes from Bunny Stream API — https://docs.bunny.net/api-reference/stream */
export const BUNNY_STREAM_STATUS = {
  CREATED: 0,
  UPLOADED: 1,
  PROCESSING: 2,
  TRANSCODING: 3,
  FINISHED: 4,
  ERROR: 5,
  UPLOAD_FAILED: 6,
} as const;

export type BunnyStreamVideoDetails = {
  videoId: string;
  status: number;
  length: number | null;
  title: string | null;
};

export function isBunnyStreamVideoAcceptable(status: number) {
  return (
    status >= BUNNY_STREAM_STATUS.UPLOADED &&
    status !== BUNNY_STREAM_STATUS.ERROR &&
    status !== BUNNY_STREAM_STATUS.UPLOAD_FAILED
  );
}

export type BunnyStreamConfig = {
  libraryId: string;
  apiKey: string;
  cdnHostname: string;
};

export function getBunnyStreamConfig(): BunnyStreamConfig | null {
  const libraryId = process.env.BUNNY_STREAM_LIBRARY_ID?.trim();
  const apiKey = process.env.BUNNY_STREAM_API_KEY?.trim();
  const cdnHostname =
    process.env.BUNNY_STREAM_CDN_HOSTNAME?.trim() ||
    process.env.BUNNY_CDN_HOSTNAME?.trim();

  if (!libraryId || !apiKey || !cdnHostname) return null;

  return { libraryId, apiKey, cdnHostname };
}

export function isBunnyStreamEnabled() {
  return getBunnyStreamConfig() !== null;
}

export function buildStreamTusAuthorization(params: {
  libraryId: string;
  apiKey: string;
  videoId: string;
  expireUnix: number;
}) {
  const payload = `${params.libraryId}${params.apiKey}${params.expireUnix}${params.videoId}`;
  const signature = createHash("sha256").update(payload).digest("hex");
  return { signature, expireUnix: params.expireUnix };
}

export function buildBunnyStreamPlayUrl(
  videoId: string,
  variant: "original" | "play_720p" = "original",
  config = getBunnyStreamConfig(),
) {
  if (!config) return null;
  const suffix = variant === "original" ? "original" : "play_720p.mp4";
  return `https://${config.cdnHostname}/${videoId}/${suffix}`;
}

export function parseBunnyStreamVideoIdFromUrl(url: string, config = getBunnyStreamConfig()) {
  if (!config) return null;
  try {
    const parsed = new URL(url);
    if (parsed.host.toLowerCase() !== config.cdnHostname.toLowerCase()) return null;
    const segment = parsed.pathname.split("/").filter(Boolean)[0];
    if (!segment || !VIDEO_GUID_RE.test(segment)) return null;
    return segment;
  } catch {
    return null;
  }
}

export function isBunnyStreamMediaUrl(url: string) {
  return Boolean(parseBunnyStreamVideoIdFromUrl(url));
}

export function bunnyStreamStorageKey(videoId: string) {
  return `bunny-stream/${videoId}`;
}

export function parseBunnyStreamStorageKey(storagePath: string) {
  const marker = "bunny-stream/";
  if (!storagePath.startsWith(marker)) return null;
  const videoId = storagePath.slice(marker.length);
  return VIDEO_GUID_RE.test(videoId) ? videoId : null;
}

export async function createBunnyStreamVideo(title: string, config = getBunnyStreamConfig()) {
  if (!config) {
    throw new Error("Bunny Stream não configurado");
  }

  const res = await fetch(`${BUNNY_STREAM_API_BASE}/library/${config.libraryId}/videos`, {
    method: "POST",
    headers: {
      AccessKey: config.apiKey,
      "Content-Type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({ title }),
  });

  const body = (await res.json().catch(() => ({}))) as { guid?: string; message?: string };
  if (!res.ok || !body.guid) {
    throw new Error(body.message ?? `Falha ao criar vídeo no Bunny Stream (${res.status})`);
  }

  return body.guid;
}

export async function deleteBunnyStreamVideo(videoId: string, config = getBunnyStreamConfig()) {
  if (!config) {
    throw new Error("Bunny Stream não configurado");
  }

  const res = await fetch(
    `${BUNNY_STREAM_API_BASE}/library/${config.libraryId}/videos/${videoId}`,
    {
      method: "DELETE",
      headers: { AccessKey: config.apiKey },
    },
  );

  if (res.status === 404) return { deleted: false, status: 404 };
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Falha ao apagar no Bunny Stream (${res.status}): ${detail || res.statusText}`);
  }

  return { deleted: true, status: res.status };
}

export async function fetchBunnyStreamVideo(
  videoId: string,
  config = getBunnyStreamConfig(),
): Promise<BunnyStreamVideoDetails | null> {
  if (!config) return null;

  const res = await fetch(
    `${BUNNY_STREAM_API_BASE}/library/${config.libraryId}/videos/${videoId}`,
    {
      headers: { AccessKey: config.apiKey, accept: "application/json" },
      cache: "no-store",
    },
  );

  if (!res.ok) return null;

  const body = (await res.json().catch(() => ({}))) as {
    guid?: string;
    status?: number;
    length?: number;
    title?: string;
  };

  if (!body.guid) return null;

  return {
    videoId: body.guid,
    status: typeof body.status === "number" ? body.status : BUNNY_STREAM_STATUS.CREATED,
    length: typeof body.length === "number" ? body.length : null,
    title: typeof body.title === "string" ? body.title : null,
  };
}

export async function headBunnyStreamVideo(videoId: string, config = getBunnyStreamConfig()) {
  const url = buildBunnyStreamPlayUrl(videoId, "original", config);
  if (!url) {
    return { exists: false, size: null, mimeType: null, error: "bunny_stream_not_configured" };
  }

  try {
    const res = await fetch(url, { method: "HEAD", cache: "no-store" });
    if (res.ok) {
      const length = res.headers.get("content-length");
      const size = length ? Number(length) : null;

      return {
        exists: true,
        size: Number.isFinite(size) ? size : null,
        mimeType: res.headers.get("content-type"),
        error: null,
      };
    }

    if (res.status !== 404) {
      return { exists: false, size: null, mimeType: null, error: `http_${res.status}` };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "head_failed";
    const apiDetails = await fetchBunnyStreamVideo(videoId, config);
    if (apiDetails && isBunnyStreamVideoAcceptable(apiDetails.status)) {
      return {
        exists: true,
        size: apiDetails.length,
        mimeType: "video/mp4",
        error: null,
      };
    }
    return { exists: false, size: null, mimeType: null, error: message };
  }

  const apiDetails = await fetchBunnyStreamVideo(videoId, config);
  if (apiDetails && isBunnyStreamVideoAcceptable(apiDetails.status)) {
    return {
      exists: true,
      size: apiDetails.length,
      mimeType: "video/mp4",
      error: null,
    };
  }

  return { exists: false, size: null, mimeType: null, error: null };
}

export function prepareBunnyStreamUpload(params: {
  videoId: string;
  title: string;
  ttlSeconds?: number;
  config?: BunnyStreamConfig | null;
}) {
  const config = params.config ?? getBunnyStreamConfig();
  if (!config) {
    throw new Error("Bunny Stream não configurado");
  }

  const expireUnix = Math.floor(Date.now() / 1000) + (params.ttlSeconds ?? 86_400);
  const auth = buildStreamTusAuthorization({
    libraryId: config.libraryId,
    apiKey: config.apiKey,
    videoId: params.videoId,
    expireUnix,
  });

  return {
    provider: "bunny-stream" as const,
    tusEndpoint: BUNNY_STREAM_TUS_ENDPOINT,
    libraryId: config.libraryId,
    videoId: params.videoId,
    authorizationSignature: auth.signature,
    authorizationExpire: auth.expireUnix,
    publicUrl: buildBunnyStreamPlayUrl(params.videoId, "original", config)!,
    storageKey: bunnyStreamStorageKey(params.videoId),
    title: params.title,
  };
}
