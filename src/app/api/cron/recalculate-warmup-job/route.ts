import { NextRequest, NextResponse } from "next/server";
import { authorizeCronRequest } from "@/lib/admin/cron-auth";
import { executeWarmupRecalculate } from "@/lib/warmup-recalculate";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Recálculo de warmup via CRON (vercel crons run). Executa de forma síncrona até maxDuration. */
export async function GET(request: NextRequest) {
  if (!authorizeCronRequest(request)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const jobId =
    request.nextUrl.searchParams.get("jobId") ??
    "f4ac3a3b-885b-44b5-ba18-c65a78f9723b";

  try {
    const result = await executeWarmupRecalculate(jobId);
    console.info("[cron/recalculate-warmup-job]", { jobId, result });
    return NextResponse.json({ jobId, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[cron/recalculate-warmup-job]", { jobId, message, error });
    return NextResponse.json({ ok: false, jobId, error: message }, { status: 500 });
  }
}
