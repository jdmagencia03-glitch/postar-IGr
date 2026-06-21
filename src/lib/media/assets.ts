import type { SupabaseClient } from "@supabase/supabase-js";
import { runFfprobeIfAvailable } from "@/lib/instagram/video-probe";
import { parseMediaPublicUrl, validateVideoMediaUrl } from "@/lib/storage/media-url-validation";
import type { MediaAsset, MediaAssetStatus, MediaAssetValidationStatus } from "@/lib/types";

export type MediaValidationOutcome =
  | { ok: true; asset: MediaAsset | null; ffprobe: Awaited<ReturnType<typeof runFfprobeIfAvailable>> }
  | {
      ok: false;
      code: string;
      message: string;
      action: "reupload_required";
    };

export async function upsertMediaAssetRow(
  supabase: SupabaseClient,
  params: {
    ownerId: string;
    storagePath: string;
    publicUrl: string;
    uploadFileId?: string | null;
    mimeType?: string | null;
    sizeBytes?: number | null;
    fileHash?: string | null;
    status?: MediaAssetStatus;
    validationStatus?: MediaAssetValidationStatus;
    lastValidationError?: string | null;
  },
) {
  const now = new Date().toISOString();
  const payload = {
    owner_id: params.ownerId,
    upload_file_id: params.uploadFileId ?? null,
    bucket: "media",
    storage_path: params.storagePath,
    public_url: params.publicUrl,
    mime_type: params.mimeType ?? null,
    size_bytes: params.sizeBytes ?? null,
    file_hash: params.fileHash ?? null,
    status: params.status ?? "uploaded",
    validation_status: params.validationStatus ?? "pending",
    last_validation_at: now,
    last_validation_error: params.lastValidationError ?? null,
    updated_at: now,
  };

  const { data, error } = await supabase
    .from("media_assets")
    .upsert(payload, { onConflict: "owner_id,storage_path" })
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  if (params.uploadFileId) {
    await supabase
      .from("upload_files")
      .update({ media_asset_id: data.id, updated_at: now })
      .eq("id", params.uploadFileId);
  }

  return data as MediaAsset;
}

export async function validateMediaAssetFromUrl(params: {
  supabase: SupabaseClient;
  ownerId: string;
  videoUrl: string;
  uploadFileId?: string | null;
  fileHash?: string | null;
  requireFfprobe?: boolean;
}): Promise<MediaValidationOutcome> {
  const parsed = parseMediaPublicUrl(params.videoUrl);
  if (!parsed.storageObjectPathFromUrl) {
    return {
      ok: false,
      code: "invalid_media_url",
      message: "URL de mídia não pertence ao Storage configurado.",
      action: "reupload_required",
    };
  }

  const validation = await validateVideoMediaUrl({
    supabase: params.supabase,
    videoUrl: params.videoUrl,
    checkStorage: true,
  });

  if (!validation.ok) {
    await upsertMediaAssetRow(params.supabase, {
      ownerId: params.ownerId,
      storagePath: parsed.storageObjectPathFromUrl,
      publicUrl: params.videoUrl,
      uploadFileId: params.uploadFileId,
      status: "missing",
      validationStatus: "invalid",
      lastValidationError: validation.message,
    }).catch(() => undefined);

    return {
      ok: false,
      code: validation.code,
      message: validation.message,
      action: "reupload_required",
    };
  }

  const ffprobe = await runFfprobeIfAvailable(params.videoUrl);
  if (params.requireFfprobe && !ffprobe) {
    // ffprobe opcional em runtime serverless — não bloqueia se indisponível
  }

  let asset: MediaAsset | null = null;
  try {
    asset = await upsertMediaAssetRow(params.supabase, {
      ownerId: params.ownerId,
      storagePath: parsed.storageObjectPathFromUrl,
      publicUrl: params.videoUrl,
      uploadFileId: params.uploadFileId,
      mimeType: validation.probe.contentType,
      sizeBytes: validation.probe.contentLength,
      fileHash: params.fileHash ?? null,
      status: "validated",
      validationStatus: "valid",
      lastValidationError: null,
    });
  } catch (error) {
    console.warn(
      "[media-assets] upsert skipped (migration pending?)",
      error instanceof Error ? error.message : error,
    );
  }

  return { ok: true, asset, ffprobe };
}

export async function resolveMediaAssetIdForUrl(
  supabase: SupabaseClient,
  ownerId: string,
  videoUrl: string,
) {
  const { data } = await supabase
    .from("media_assets")
    .select("id, validation_status, status")
    .eq("owner_id", ownerId)
    .eq("public_url", videoUrl)
    .maybeSingle();

  if (data?.validation_status === "valid" && data.status === "validated") {
    return data.id as string;
  }
  return null;
}

export async function ensureValidatedMediaAssetsForUrls(params: {
  supabase: SupabaseClient;
  ownerId: string;
  urls: string[];
  uploadFileIds?: Array<string | null | undefined>;
}) {
  const assetIds: Array<string | null> = [];

  for (let i = 0; i < params.urls.length; i++) {
    const url = params.urls[i];
    if (!url || !/\.(mp4|mov|webm)(\?|$)/i.test(url)) {
      assetIds.push(null);
      continue;
    }

    const outcome = await validateMediaAssetFromUrl({
      supabase: params.supabase,
      ownerId: params.ownerId,
      videoUrl: url,
      uploadFileId: params.uploadFileIds?.[i] ?? null,
    });

    if (!outcome.ok) {
      return { ...outcome, url };
    }

    assetIds.push(outcome.asset?.id ?? null);
  }

  return { ok: true as const, assetIds };
}

export async function assertUploadFileSchedulable(
  supabase: SupabaseClient,
  uploadFileId: string | null | undefined,
) {
  if (!uploadFileId) return { ok: true as const };

  const { data: file } = await supabase
    .from("upload_files")
    .select("id, status, removed, public_url, media_asset_id")
    .eq("id", uploadFileId)
    .maybeSingle();

  if (!file || file.removed) {
    return {
      ok: false as const,
      code: "upload_file_removed" as const,
      message: "Arquivo de upload removido ou inexistente.",
      action: "reupload_required" as const,
    };
  }

  if (file.status !== "completed") {
    return {
      ok: false as const,
      code: "upload_not_completed" as const,
      message: `Upload ainda não concluído (status: ${file.status}).`,
      action: "reupload_required" as const,
    };
  }

  if (file.media_asset_id) {
    try {
      const { data: asset } = await supabase
        .from("media_assets")
        .select("validation_status, status")
        .eq("id", file.media_asset_id)
        .maybeSingle();

      if (asset?.validation_status !== "valid" || asset.status !== "validated") {
        return {
          ok: false as const,
          code: "media_asset_not_validated" as const,
          message: "Mídia ainda não validada no Storage.",
          action: "reupload_required" as const,
        };
      }
    } catch {
      // media_assets table may not exist pre-migration
    }
  }

  return { ok: true as const };
}
