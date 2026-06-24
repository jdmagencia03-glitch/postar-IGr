import { NextResponse } from "next/server";
import {
  getBunnyMediaBackend,
  getBunnyStorageConfig,
  getMediaStorageProvider,
  isBunnyMediaEnabled,
} from "@/lib/storage/bunny";
import { getBunnyStreamConfig } from "@/lib/storage/bunny-stream";
import {
  MAX_SAFE_UPLOAD_CONCURRENCY,
  MAX_UPLOAD_MB,
  UPLOAD_CONCURRENCY_DEFAULT,
  UPLOAD_FILE_CONCURRENCY,
  getEffectiveUploadConcurrency,
} from "@/lib/upload/storage-config";

export async function GET() {
  const hasSupabaseUrl = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL?.trim());
  const hasSupabaseServiceKey = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY?.trim());
  const stream = getBunnyStreamConfig();
  const storage = getBunnyStorageConfig();
  const backend = getBunnyMediaBackend();
  const provider = getMediaStorageProvider();

  return NextResponse.json({
    ok: true,
    mediaStorageProvider: provider,
    bunnyMediaBackend: backend,
    storageConfigOk: provider === "bunny" ? isBunnyMediaEnabled() : hasSupabaseUrl,
    bunnyConfigured: isBunnyMediaEnabled(),
    bunnyStreamConfigured: Boolean(stream),
    bunnyStorageConfigured: Boolean(storage),
    bunnyCdnHostname: stream?.cdnHostname ?? storage?.cdnHostname ?? null,
    bunnyStreamLibraryId: stream?.libraryId ?? null,
    maxUploadMb: MAX_UPLOAD_MB,
    defaultConcurrency: UPLOAD_CONCURRENCY_DEFAULT,
    maxSafeUploadConcurrency: MAX_SAFE_UPLOAD_CONCURRENCY,
    concurrencyConfigured: UPLOAD_FILE_CONCURRENCY,
    concurrencyEffective: getEffectiveUploadConcurrency(),
    supabaseEnvOk: hasSupabaseUrl && hasSupabaseServiceKey,
  });
}
