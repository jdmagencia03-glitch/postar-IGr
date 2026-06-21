import { NextRequest, NextResponse } from "next/server";
import { runInstagramPublishCron } from "@/lib/publish/cron-run-instagram";
import {
  authorizePublishCron,
  createPublishCronSupabase,
  publishCronSupabaseErrorResponse,
  unauthorizedPublishCronResponse,
} from "@/lib/publish/cron-route";
import { toOrchestratorPlatformSummary } from "@/lib/publish/cron-run-shared";

export const maxDuration = 120;
export const dynamic = "force-dynamic";

/** Cron isolado — apenas posts platform=instagram. */
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
    const result = await runInstagramPublishCron(supabase);
    return NextResponse.json(
      {
        platform: "instagram",
        ...toOrchestratorPlatformSummary(result),
        media_cleanup: result.media_cleanup,
        results: result.results,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("[cron/publish/instagram]", error);
    return NextResponse.json(
      {
        ok: false,
        platform: "instagram",
        isolated: true,
        error: error instanceof Error ? error.message : "Falha no cron Instagram",
      },
      { status: 500 },
    );
  }
}
