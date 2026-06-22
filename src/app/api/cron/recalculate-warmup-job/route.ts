import { NextRequest, NextResponse } from "next/server";
import { authorizeCronRequest } from "@/lib/admin/cron-auth";
import { executeWarmupRecalculate } from "@/lib/warmup-recalculate";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Dispara recálculo de warmup via CRON (vercel crons run). */
export async function GET(request: NextRequest) {
  if (!authorizeCronRequest(request)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const jobId =
    request.nextUrl.searchParams.get("jobId") ??
    process.env.RECALCULATE_WARMUP_JOB_ID ??
    "f4ac3a3b-885b-44b5-ba18-c65a78f9723b";

  try {
    const result = await executeWarmupRecalculate(jobId);
    return NextResponse.json({ jobId, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, jobId, error: message }, { status: 500 });
  }
}
