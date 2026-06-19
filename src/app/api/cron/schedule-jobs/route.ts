import { NextRequest, NextResponse } from "next/server";
import { processActiveScheduleJobs } from "@/lib/schedule-jobs/cron";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCronSecret } from "@/lib/security/secrets";

export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = getCronSecret();

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  try {
    const supabase = createAdminClient();
    const results = await processActiveScheduleJobs(supabase, {
      maxJobs: 3,
      advancesPerJob: 2,
    });

    return NextResponse.json({
      processed: results.length,
      results,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha no cron de agendamento" },
      { status: 500 },
    );
  }
}
