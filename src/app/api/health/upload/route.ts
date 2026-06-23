import { NextResponse } from "next/server";
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

  return NextResponse.json({
    ok: true,
    storageConfigOk: hasSupabaseUrl,
    maxUploadMb: MAX_UPLOAD_MB,
    defaultConcurrency: UPLOAD_CONCURRENCY_DEFAULT,
    maxSafeUploadConcurrency: MAX_SAFE_UPLOAD_CONCURRENCY,
    concurrencyConfigured: UPLOAD_FILE_CONCURRENCY,
    concurrencyEffective: getEffectiveUploadConcurrency(),
    supabaseEnvOk: hasSupabaseUrl && hasSupabaseServiceKey,
  });
}
