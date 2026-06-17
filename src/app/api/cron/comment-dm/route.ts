import { NextRequest, NextResponse } from "next/server";
import { pollAutomationsForComments, processPendingEvents } from "@/lib/comment-dm/processor";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCronSecret } from "@/lib/security/secrets";

export const maxDuration = 120;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = getCronSecret();

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const supabase = createAdminClient();

  const [pendingResults, pollResults] = await Promise.all([
    processPendingEvents(supabase),
    pollAutomationsForComments(supabase),
  ]);

  return NextResponse.json({
    pending_processed: pendingResults.length,
    pending_results: pendingResults,
    poll_results: pollResults,
  });
}
