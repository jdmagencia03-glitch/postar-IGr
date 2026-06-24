import { randomUUID } from "crypto";

import { getBunnyStorageConfig } from "@/lib/storage/bunny";
import { getBunnyStreamConfig, isBunnyStreamMediaUrl } from "@/lib/storage/bunny-stream";
import { parseMediaStoragePathFromUrl } from "@/lib/storage/media-path";
import {
  MAX_UPLOAD_BYTES,
  formatMaxUploadSize,
} from "@/lib/upload/storage-config";

export { MAX_UPLOAD_BYTES, formatMaxUploadSize };

const ALLOWED_EXTENSIONS = new Set(["mp4", "mov", "webm", "jpg", "jpeg", "png", "webp"]);
const ALLOWED_MIME_TYPES = new Set([
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export function sanitizeExtension(filename: string) {
  const ext = filename.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "mp4";
  return ALLOWED_EXTENSIONS.has(ext) ? ext : null;
}

export function validateUploadMetadata(params: {
  filename: string;
  size: number;
  contentType?: string | null;
}) {
  if (params.size <= 0) {
    return { ok: false as const, error: "Arquivo vazio." };
  }

  if (params.size > MAX_UPLOAD_BYTES) {
    return { ok: false as const, error: `${params.filename} excede ${formatMaxUploadSize()}.` };
  }

  const ext = sanitizeExtension(params.filename);
  if (!ext) {
    return { ok: false as const, error: `${params.filename} tem extensão não permitida.` };
  }

  if (params.contentType && !ALLOWED_MIME_TYPES.has(params.contentType)) {
    return { ok: false as const, error: `${params.filename} tem tipo MIME não permitido.` };
  }

  return { ok: true as const, ext };
}

export function assertOwnerStoragePath(ownerId: string, storagePath: string) {
  const normalized = storagePath.replace(/^\/+/, "");
  if (normalized.includes("..")) {
    return { ok: false as const, error: "Caminho de storage inválido." };
  }

  if (!normalized.startsWith(`${ownerId}/`)) {
    return { ok: false as const, error: "Caminho de storage não pertence ao usuário." };
  }

  return { ok: true as const, path: normalized };
}

export function buildRandomStoragePath(ownerId: string, ext: string) {
  const safeExt = ALLOWED_EXTENSIONS.has(ext) ? ext : "mp4";
  return `${ownerId}/${Date.now()}-${randomUUID()}.${safeExt}`;
}

function isAllowedSupabaseMediaUrlForOwner(url: string, ownerId: string) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) return false;

  const parsed = new URL(url);
  const allowedHosts = new Set<string>();
  allowedHosts.add(new URL(supabaseUrl).host);

  const projectRef = supabaseUrl.replace("https://", "").replace("http://", "").split(".")[0];
  allowedHosts.add(`${projectRef}.supabase.co`);
  allowedHosts.add(`${projectRef}.storage.supabase.co`);

  if (!allowedHosts.has(parsed.host)) return false;

  const marker = `/storage/v1/object/public/media/${ownerId}/`;
  return parsed.pathname.includes(marker);
}

function isAllowedBunnyStreamMediaUrl(url: string, ownerId: string) {
  if (!isBunnyStreamMediaUrl(url)) return false;
  const storagePath = parseMediaStoragePathFromUrl(url);
  if (!storagePath?.startsWith("bunny-stream/")) return false;
  // Vídeos Stream são vinculados ao owner via upload_files.public_url no agendamento.
  void ownerId;
  return true;
}

function isAllowedBunnyStorageMediaUrlForOwner(url: string, ownerId: string) {
  const bunny = getBunnyStorageConfig();
  if (!bunny) return false;

  const parsed = new URL(url);
  if (parsed.host.toLowerCase() !== bunny.cdnHostname.toLowerCase()) return false;

  const storagePath = parseMediaStoragePathFromUrl(url);
  return Boolean(storagePath?.startsWith(`${ownerId}/`));
}

export function isAllowedMediaUrlForOwner(url: string, ownerId: string) {
  try {
    return (
      isAllowedBunnyStreamMediaUrl(url, ownerId) ||
      isAllowedBunnyStorageMediaUrlForOwner(url, ownerId) ||
      isAllowedSupabaseMediaUrlForOwner(url, ownerId)
    );
  } catch {
    return false;
  }
}

export function validateMediaUrlsForOwner(urls: string[], ownerId: string) {
  for (const url of urls) {
    if (!isAllowedMediaUrlForOwner(url, ownerId)) {
      return { ok: false as const, error: "URL de mídia inválida ou não pertence ao usuário." };
    }
  }
  return { ok: true as const };
}
