import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/meta/oauth";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  BROWSER_UPLOAD_CONCURRENCY_CAP,
  MAX_UPLOAD_MB,
  MAX_SAFE_UPLOAD_CONCURRENCY,
  UPLOAD_CONCURRENCY_DEFAULT,
  UPLOAD_FILE_CONCURRENCY,
  formatBucketLimitMb,
  getEffectiveUploadConcurrency,
  getSpeedPresets,
} from "@/lib/upload/storage-config";

export async function GET() {
  const ownerId = await getSessionUserId();
  if (!ownerId) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const { data: bucket, error } = await supabase.storage.getBucket("media");

  const bucketLimitBytes = bucket?.file_size_limit ?? null;
  const bucketLimitMb =
    bucketLimitBytes && bucketLimitBytes > 0
      ? Math.floor(bucketLimitBytes / (1024 * 1024))
      : null;

  const effectiveMaxMb =
    bucketLimitMb && bucketLimitMb > 0
      ? Math.min(MAX_UPLOAD_MB, bucketLimitMb)
      : MAX_UPLOAD_MB;

  const speedPresets = getSpeedPresets();

  return NextResponse.json({
    max_upload_mb: effectiveMaxMb,
    app_max_upload_mb: MAX_UPLOAD_MB,
    bucket_limit_mb: bucketLimitMb,
    bucket_limit_label: formatBucketLimitMb(bucketLimitBytes),
    bucket_error: error?.message ?? null,
    browser_concurrency_cap: BROWSER_UPLOAD_CONCURRENCY_CAP,
    max_safe_upload_concurrency: MAX_SAFE_UPLOAD_CONCURRENCY,
    default_concurrency: UPLOAD_CONCURRENCY_DEFAULT,
    concurrency: getEffectiveUploadConcurrency(),
    concurrency_configured: UPLOAD_FILE_CONCURRENCY,
    speed_presets: speedPresets,
  });
}
