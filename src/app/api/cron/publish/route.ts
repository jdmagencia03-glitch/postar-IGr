import { NextRequest, NextResponse } from "next/server";
import { runPublishCronOrchestrator } from "@/lib/publish/cron-run-orchestrator";
import {
  authorizePublishCron,
  createPublishCronSupabase,
  publishCronSupabaseErrorResponse,
  unauthorizedPublishCronResponse,
} from "@/lib/publish/cron-route";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

/** Orquestrador: Instagram e TikTok rodam isolados (Promise.allSettled). */
export async function GET(request: NextRequest) {
  if (!authorizePublishCron(request)) {
    return unauthorizedPublishCronResponse();
  }

  let supabase;
  try {
    supabase = createPublishCronSupabase();
  } catch (error) {
    return publishCronSupabaseErrorResponse(error);
  }

  try {
    const result = await runPublishCronOrchestrator(supabase);
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    console.error("[cron/publish]", error);
    return NextResponse.json(
      {
        ok: false,
        mode: "orchestrator",
        error: error instanceof Error ? error.message : "Falha no orquestrador de publicação",
      },
      { status: 500 },
    );
  }
}
