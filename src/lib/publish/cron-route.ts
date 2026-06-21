import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCronSecret } from "@/lib/security/secrets";

export function authorizePublishCron(request: NextRequest) {
  const cronSecret = getCronSecret();
  if (!cronSecret) return false;
  return request.headers.get("authorization") === `Bearer ${cronSecret}`;
}

export function createPublishCronSupabase() {
  return createAdminClient();
}

export function unauthorizedPublishCronResponse() {
  return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
}

export function publishCronSupabaseErrorResponse(error: unknown) {
  return NextResponse.json(
    {
      ok: false,
      error: error instanceof Error ? error.message : "Supabase client failed",
    },
    { status: 503 },
  );
}
