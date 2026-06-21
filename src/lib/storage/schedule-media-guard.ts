import type { SupabaseClient } from "@supabase/supabase-js";
import { assertUploadFileSchedulable, ensureValidatedMediaAssetsForUrls } from "@/lib/media/assets";
import { validateMediaUrlsForOwner } from "@/lib/security/ownership";
import {
  validateVideoMediaUrl,
  type VideoUrlValidationCode,
} from "@/lib/storage/media-url-validation";

function isLikelyVideoUrl(url: string) {
  return /\.(mp4|mov|webm)(\?|$)/i.test(url) || url.toLowerCase().includes("video/");
}

export type ScheduleMediaGuardFailure = {
  ok: false;
  code: VideoUrlValidationCode | "invalid_media_url" | "upload_not_completed" | "upload_file_removed" | "media_asset_not_validated";
  message: string;
  action: "reupload_required";
  url?: string;
};

export async function validateScheduledMediaUrls(params: {
  supabase: SupabaseClient;
  ownerId: string;
  urls: string[];
  uploadFileId?: string | null;
}) {
  const ownership = validateMediaUrlsForOwner(params.urls, params.ownerId);
  if (!ownership.ok) {
    return {
      ok: false as const,
      code: "invalid_media_url" as const,
      message: ownership.error ?? "URL de mídia inválida.",
      action: "reupload_required" as const,
    } satisfies ScheduleMediaGuardFailure;
  }

  const uploadCheck = await assertUploadFileSchedulable(params.supabase, params.uploadFileId);
  if (!uploadCheck.ok) {
    return {
      ok: false as const,
      code: uploadCheck.code,
      message: uploadCheck.message,
      action: uploadCheck.action,
    } satisfies ScheduleMediaGuardFailure;
  }

  for (const url of params.urls) {
    if (!isLikelyVideoUrl(url)) continue;

    const result = await validateVideoMediaUrl({
      supabase: params.supabase,
      videoUrl: url,
      checkStorage: true,
    });

    if (!result.ok) {
      return {
        ok: false as const,
        code: result.code as VideoUrlValidationCode,
        message: result.message,
        action: "reupload_required" as const,
        url,
      } satisfies ScheduleMediaGuardFailure;
    }
  }

  const assets = await ensureValidatedMediaAssetsForUrls({
    supabase: params.supabase,
    ownerId: params.ownerId,
    urls: params.urls,
    uploadFileIds: params.uploadFileId ? [params.uploadFileId] : undefined,
  });

  if (!assets.ok) {
    return {
      ok: false as const,
      code: assets.code as VideoUrlValidationCode,
      message: assets.message,
      action: assets.action,
      url: assets.url,
    } satisfies ScheduleMediaGuardFailure;
  }

  return { ok: true as const, mediaAssetIds: assets.assetIds };
}

export function scheduleMediaGuardJsonError(result: ScheduleMediaGuardFailure) {
  return {
    error: result.message,
    code: result.code,
    action: result.action,
  };
}
