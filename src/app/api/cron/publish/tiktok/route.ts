import { NextRequest, NextResponse } from "next/server";
import { runTikTokPublishCron } from "@/lib/publish/cron-run-tiktok";
import {
  authorizePublishCron,
  createPublishCronSupabase,
  publishCronSupabaseErrorResponse,
  unauthorizedPublishCronResponse,
} from "@/lib/publish/cron-route";
import { toOrchestratorPlatformSummary } from "@/lib/publish/cron-run-shared";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

/** Cron isolado — apenas posts platform=tiktok (FILE_UPLOAD, SELF_ONLY se não auditado). */
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
    const result = await runTikTokPublishCron(supabase);
    return NextResponse.json(
      {
        platform: "tiktok",
        ...toOrchestratorPlatformSummary(result),
        results: result.results,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("[cron/publish/tiktok]", error);
    return NextResponse.json(
      {
        ok: false,
        platform: "tiktok",
        isolated: true,
        error: error instanceof Error ? error.message : "Falha no cron TikTok",
      },
      { status: 500 },
    );
  }
}
