import { getBunnyStreamConfig } from "@/lib/storage/bunny-stream";
import { isBunnyStreamMediaUrl } from "@/lib/storage/bunny-stream";
import { getSupabaseStorageHost } from "@/lib/upload/storage-url";

export type TikTokUploadMethod = "FILE_UPLOAD" | "PULL_FROM_URL";

function parseEnvMethod(): TikTokUploadMethod | null {
  const raw = process.env.TIKTOK_UPLOAD_METHOD?.trim().toLowerCase();
  if (!raw) return null;
  if (raw === "file_upload" || raw === "file" || raw === "upload") return "FILE_UPLOAD";
  if (raw === "pull_from_url" || raw === "pull" || raw === "url") return "PULL_FROM_URL";
  return null;
}

export function isBunnyCdnVideoUrl(videoUrl: string) {
  return isBunnyStreamMediaUrl(videoUrl) || isBunnyStorageVideoUrl(videoUrl);
}

function isBunnyStorageVideoUrl(videoUrl: string) {
  const bunny = getBunnyStreamConfig();
  // Storage zone usa BUNNY_CDN_HOSTNAME sem stream library
  const storage = process.env.BUNNY_STORAGE_ZONE?.trim();
  const cdn = process.env.BUNNY_CDN_HOSTNAME?.trim();
  if (!storage || !cdn) return false;
  try {
    const parsed = new URL(videoUrl);
    if (bunny && parsed.host.toLowerCase() === bunny.cdnHostname.toLowerCase()) {
      return !isBunnyStreamMediaUrl(videoUrl);
    }
    return parsed.host.toLowerCase() === cdn.toLowerCase();
  } catch {
    return false;
  }
}

export function isSupabaseStorageVideoUrl(videoUrl: string) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
    if (!supabaseUrl) return false;
    const parsed = new URL(videoUrl);
    const storageHost = new URL(getSupabaseStorageHost(supabaseUrl)).host;
    const projectHost = new URL(supabaseUrl).host;
    return (
      parsed.host === storageHost ||
      parsed.host === projectHost ||
      parsed.host.endsWith(".storage.supabase.co") ||
      parsed.pathname.includes("/storage/v1/object/")
    );
  } catch {
    return false;
  }
}

export function isAppHostedVideoUrl(videoUrl: string) {
  return isBunnyCdnVideoUrl(videoUrl) || isSupabaseStorageVideoUrl(videoUrl);
}

export function resolveTikTokUploadMethod(videoUrl?: string | null): TikTokUploadMethod {
  const fromEnv = parseEnvMethod();
  if (fromEnv) return fromEnv;

  if (videoUrl && isAppHostedVideoUrl(videoUrl)) {
    return "FILE_UPLOAD";
  }

  return "FILE_UPLOAD";
}

export function isUrlOwnershipRiskForPull(videoUrl: string | null | undefined) {
  if (!videoUrl) return false;
  return isAppHostedVideoUrl(videoUrl);
}

export function videoUrlHost(videoUrl: string | null | undefined) {
  if (!videoUrl) return null;
  try {
    return new URL(videoUrl).host;
  } catch {
    return null;
  }
}

export function extractTikTokErrorCode(message: string) {
  const match = message.match(/^([a-z0-9_]+):/i);
  return match?.[1] ?? null;
}

export function tiktokPublishFailureAction(params: {
  method: TikTokUploadMethod;
  videoUrl: string | null | undefined;
  message: string;
}) {
  if (/url_ownership_unverified/i.test(params.message)) {
    if (params.method === "PULL_FROM_URL") {
      return "Verifique o domínio no TikTok Developers ou defina TIKTOK_UPLOAD_METHOD=file_upload";
    }
    return "FILE_UPLOAD falhou — confira formato MP4, tamanho e token video.upload";
  }
  if (/inacessível|inaccessible|404|403/i.test(params.message)) {
    return "Confirme que o vídeo está acessível no CDN de mídia";
  }
  if (/unaudited_client_can_only_post_to_private_accounts/i.test(params.message)) {
    return "Use privacyLevel SELF_ONLY e deixe a conta TikTok privada até o app ser auditado";
  }
  return null;
}

export function isTikTokUnauditedClientError(message: string) {
  return /unaudited_client_can_only_post_to_private_accounts/i.test(message);
}

export const TIKTOK_UNAUDITED_CLIENT_NEXT_STEPS = [
  "Tornar a conta TikTok privada temporariamente para teste",
  "Testar novamente com privacyLevel SELF_ONLY",
  "Depois solicitar auditoria do app para publicar publicamente",
] as const;

export function formatTikTokPublishFailureLog(params: {
  method: TikTokUploadMethod;
  videoUrl: string | null | undefined;
  message: string;
}) {
  const errorCode = extractTikTokErrorCode(params.message) ?? params.message.slice(0, 80);
  const action = tiktokPublishFailureAction(params);
  const host = videoUrlHost(params.videoUrl) ?? "unknown";
  return [
    `method=${params.method}`,
    `videoSourceHost=${host}`,
    `errorCode=${errorCode}`,
    action ? `action=${action}` : null,
    params.message,
  ]
    .filter(Boolean)
    .join(" | ");
}
