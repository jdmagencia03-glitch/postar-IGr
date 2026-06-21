import { NextRequest, NextResponse } from "next/server";
import { getScheduleJobsHealthSnapshot } from "@/lib/schedule-jobs/health";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCronSecret } from "@/lib/security/secrets";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  let cronSecretConfigured = false;
  let authOk = false;

  try {
    const cronSecret = getCronSecret();
    cronSecretConfigured = Boolean(cronSecret);
    authOk = Boolean(cronSecret && authHeader === `Bearer ${cronSecret}`);
  } catch {
    cronSecretConfigured = false;
  }

  if (!authOk) {
    return NextResponse.json(
      {
        ok: false,
        authOk: false,
        cronSecretConfigured,
        message: authHeader
          ? "Authorization header does not match CRON_SECRET"
          : "Missing Authorization: Bearer CRON_SECRET",
        action: cronSecretConfigured
          ? "use the same Bearer token as configured in Vercel CRON_SECRET"
          : "set CRON_SECRET in Vercel Production and redeploy",
      },
      { status: authHeader ? 401 : 401 },
    );
  }

  let supabase;
  try {
    supabase = createAdminClient();
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        authOk: true,
        cronSecretConfigured: true,
        supabaseConnected: false,
        message: err instanceof Error ? err.message : "Supabase client failed",
        action: "check NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY",
      },
      { status: 503 },
    );
  }

  try {
    const snapshot = await getScheduleJobsHealthSnapshot(supabase, {
      authOk: true,
      cronSecretConfigured: true,
    });

    return NextResponse.json(
      {
        ...snapshot,
        message: snapshot.ok
          ? snapshot.activeJobs > 0
            ? `${snapshot.activeJobs} active job(s), ${snapshot.stalledJobs} stalled`
            : "schema ok, no active jobs"
          : snapshot.schema.action ?? snapshot.schema.error,
      },
      { status: snapshot.ok ? 200 : 200 },
    );
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        authOk: true,
        message: err instanceof Error ? err.message : "Health check failed",
      },
      { status: 200 },
    );
  }
}
