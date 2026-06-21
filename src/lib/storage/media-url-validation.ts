import type { SupabaseClient } from "@supabase/supabase-js";
import { parseSupabaseMediaStoragePath } from "@/lib/storage/cleanup";

export const MEDIA_BUCKET = "media";

export type ParsedMediaUrl = {
  videoUrl: string;
  storageBucket: string;
  storageObjectPathFromUrl: string | null;
  fileName: string | null;
  ownerIdFromPath: string | null;
  batchIdFromPath: string | null;
  uploadFileIdFromPath: string | null;
};

export type HttpMediaProbe = {
  httpStatus: number | null;
  contentType: string | null;
  contentLength: number | null;
  responseBodyPreview: string | null;
  accessible: boolean;
  isVideoContentType: boolean;
  looksLikeStorageErrorJson: boolean;
  zeroBytes: boolean;
};

export type StorageObjectMeta = {
  exists: boolean;
  size: number | null;
  mimeType: string | null;
  error: string | null;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseMediaPublicUrl(videoUrl: string): ParsedMediaUrl {
  const storageObjectPathFromUrl = parseSupabaseMediaStoragePath(videoUrl);
  const fileName = storageObjectPathFromUrl?.split("/").pop() ?? null;
  const segments = storageObjectPathFromUrl?.split("/") ?? [];

  const ownerIdFromPath = segments[0] ?? null;
  const batchIdFromPath = segments[1] && UUID_RE.test(segments[1]) ? segments[1] : null;
  const uploadFileIdFromPath =
    fileName && UUID_RE.test(fileName.replace(/\.[^.]+$/, ""))
      ? fileName.replace(/\.[^.]+$/, "")
      : null;

  return {
    videoUrl,
    storageBucket: MEDIA_BUCKET,
    storageObjectPathFromUrl,
    fileName,
    ownerIdFromPath,
    batchIdFromPath,
    uploadFileIdFromPath,
  };
}

export function buildPublicMediaUrl(storagePath: string) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) return null;
  return `${supabaseUrl.replace(/\/$/, "")}/storage/v1/object/public/${MEDIA_BUCKET}/${storagePath}`;
}

function parseContentLength(value: string | null) {
  if (!value) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function truncatePreview(text: string, max = 500) {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max)}…`;
}

export async function probeHttpMediaUrl(videoUrl: string): Promise<HttpMediaProbe> {
  let httpStatus: number | null = null;
  let contentType: string | null = null;
  let contentLength: number | null = null;
  let responseBodyPreview: string | null = null;

  try {
    const res = await fetch(videoUrl, {
      method: "GET",
      redirect: "follow",
      cache: "no-store",
      headers: { Range: "bytes=0-4095" },
    });
    httpStatus = res.status;
    contentType = res.headers.get("content-type");
    contentLength =
      parseContentLength(res.headers.get("content-range")?.split("/")[1] ?? null) ??
      parseContentLength(res.headers.get("content-length"));

    const ct = contentType?.toLowerCase() ?? "";
    if (ct.includes("json") || ct.includes("xml") || (httpStatus >= 400 && httpStatus !== 206)) {
      const text = await res.text().catch(() => "");
      responseBodyPreview = truncatePreview(text);
    }
  } catch (error) {
    responseBodyPreview = truncatePreview(
      error instanceof Error ? error.message : "Falha ao acessar URL",
    );
  }

  const looksLikeStorageErrorJson =
    Boolean(responseBodyPreview?.includes('"statusCode"')) ||
    Boolean(responseBodyPreview?.includes("Object not found")) ||
    Boolean(responseBodyPreview?.includes('"error":"not_found"'));

  const isVideoContentType = Boolean(contentType?.toLowerCase().includes("video/"));
  const zeroBytes = contentLength === 0;
  const accessible =
    httpStatus !== null &&
    httpStatus >= 200 &&
    httpStatus < 400 &&
    isVideoContentType &&
    !zeroBytes &&
    !looksLikeStorageErrorJson;

  return {
    httpStatus,
    contentType,
    contentLength,
    responseBodyPreview,
    accessible,
    isVideoContentType,
    looksLikeStorageErrorJson,
    zeroBytes,
  };
}

export async function getStorageObjectMeta(
  supabase: SupabaseClient,
  storagePath: string,
): Promise<StorageObjectMeta> {
  const segments = storagePath.split("/");
  const fileName = segments.pop();
  const folder = segments.join("/");

  if (!fileName) {
    return { exists: false, size: null, mimeType: null, error: "invalid_path" };
  }

  const { data, error } = await supabase.storage.from(MEDIA_BUCKET).list(folder, {
    limit: 1000,
  });

  if (error) {
    return { exists: false, size: null, mimeType: null, error: error.message };
  }

  const match = (data ?? []).find((item) => item.name === fileName && item.id);
  if (!match) {
    return { exists: false, size: null, mimeType: null, error: null };
  }

  const sizeRaw = match.metadata?.size ?? match.metadata?.contentLength;
  const size =
    typeof sizeRaw === "number"
      ? sizeRaw
      : typeof sizeRaw === "string"
        ? Number(sizeRaw)
        : null;

  const mimeType =
    (typeof match.metadata?.mimetype === "string" && match.metadata.mimetype) ||
    (typeof match.metadata?.contentType === "string" && match.metadata.contentType) ||
    null;

  return {
    exists: true,
    size: Number.isFinite(size) ? size : null,
    mimeType,
    error: null,
  };
}

export type VideoUrlValidationCode =
  | "video_storage_object_missing"
  | "video_invalid_content_type"
  | "video_zero_bytes"
  | "video_url_unreachable";

export type VideoUrlValidationResult =
  | { ok: true; probe: HttpMediaProbe; storage: StorageObjectMeta | null }
  | { ok: false; code: VideoUrlValidationCode; message: string; probe: HttpMediaProbe; storage: StorageObjectMeta | null };

export async function validateVideoMediaUrl(params: {
  supabase?: SupabaseClient;
  videoUrl: string;
  checkStorage?: boolean;
}): Promise<VideoUrlValidationResult> {
  const parsed = parseMediaPublicUrl(params.videoUrl);
  const probe = await probeHttpMediaUrl(params.videoUrl);

  let storage: StorageObjectMeta | null = null;
  if (params.checkStorage !== false && params.supabase && parsed.storageObjectPathFromUrl) {
    storage = await getStorageObjectMeta(params.supabase, parsed.storageObjectPathFromUrl);
  }

  const storageMissing =
    storage !== null && !storage.exists && parsed.storageObjectPathFromUrl !== null;

  if (storageMissing || probe.looksLikeStorageErrorJson || probe.httpStatus === 404) {
    return {
      ok: false,
      code: "video_storage_object_missing",
      message: "Objeto de vídeo não encontrado no Supabase Storage.",
      probe,
      storage,
    };
  }

  if (!probe.accessible) {
    if (probe.httpStatus === null) {
      return {
        ok: false,
        code: "video_url_unreachable",
        message: "URL de vídeo inacessível.",
        probe,
        storage,
      };
    }
    if (probe.zeroBytes) {
      return {
        ok: false,
        code: "video_zero_bytes",
        message: "Arquivo de vídeo vazio (0 bytes).",
        probe,
        storage,
      };
    }
    if (!probe.isVideoContentType) {
      return {
        ok: false,
        code: "video_invalid_content_type",
        message: `Content-Type inválido para vídeo: ${probe.contentType ?? "desconhecido"}`,
        probe,
        storage,
      };
    }
    return {
      ok: false,
      code: "video_url_unreachable",
      message: `URL de vídeo retornou HTTP ${probe.httpStatus}.`,
      probe,
      storage,
    };
  }

  return { ok: true, probe, storage };
}

export async function validateVideoMediaUrlsForSchedule(params: {
  supabase: SupabaseClient;
  urls: string[];
}) {
  for (const url of params.urls) {
    const result = await validateVideoMediaUrl({
      supabase: params.supabase,
      videoUrl: url,
      checkStorage: true,
    });
    if (!result.ok) {
      return result;
    }
  }
  return { ok: true as const };
}
