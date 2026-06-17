import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/meta/oauth";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  MAX_UPLOAD_MB,
  UPLOAD_FILE_CONCURRENCY,
  formatBucketLimitMb,
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

  return NextResponse.json({
    max_upload_mb: effectiveMaxMb,
    app_max_upload_mb: MAX_UPLOAD_MB,
    bucket_limit_mb: bucketLimitMb,
    bucket_limit_label: formatBucketLimitMb(bucketLimitBytes),
    bucket_error: error?.message ?? null,
    concurrency: UPLOAD_FILE_CONCURRENCY,
  });
}
