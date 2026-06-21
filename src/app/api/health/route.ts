import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

function createRequestId() {
  return `REQ-${Math.random().toString(36).slice(2, 8)}`;
}

export async function GET() {
  const requestId = createRequestId();
  const checks: Record<string, boolean | string> = {
    requestId,
    serverTime: new Date().toISOString(),
    timezone: "America/Sao_Paulo",
  };

  checks.cronSecret = Boolean(process.env.CRON_SECRET?.trim());
  checks.supabaseUrl = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL?.trim());
  checks.supabaseServiceKey = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY?.trim());
  checks.openai = Boolean(process.env.OPENAI_API_KEY?.trim());

  let supabaseOk = false;
  try {
    const supabase = createAdminClient();
    const { error } = await supabase.from("schedule_jobs").select("id", { count: "exact", head: true });
    supabaseOk = !error;
    if (error) checks.supabaseError = error.message;
  } catch (err) {
    checks.supabaseError = err instanceof Error ? err.message : "Supabase client failed";
  }

  const ok =
    supabaseOk &&
    checks.supabaseUrl === true &&
    checks.supabaseServiceKey === true;

  return NextResponse.json(
    {
      ok,
      app: "postarigr",
      requestId,
      checks,
      endpoints: {
        scheduleJobs: "/api/health/schedule-jobs",
      },
      message: ok ? "App online" : "Verifique variáveis de ambiente ou Supabase",
    },
    { status: ok ? 200 : 503 },
  );
}
