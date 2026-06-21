import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/meta/oauth";
import { getProfessionalScheduleJobsHealth } from "@/lib/schedule-jobs/queue/health";
import { getCronSecret } from "@/lib/security/secrets";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

function isAuthorized(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  try {
    const secret = getCronSecret();
    if (secret && authHeader === `Bearer ${secret}`) return true;
  } catch {
    // dev without secret
  }
  return false;
}

export async function GET(request: NextRequest) {
  const cronAuth = isAuthorized(request);
  if (!cronAuth) {
    const ownerId = await getSessionUserId();
    if (!ownerId) {
      return NextResponse.json({ ok: false, error: "Não autenticado" }, { status: 401 });
    }
  }

  try {
    const supabase = createAdminClient();
    const snapshot = await getProfessionalScheduleJobsHealth(supabase);
    return NextResponse.json(snapshot);
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Health check failed",
      },
      { status: 503 },
    );
  }
}
