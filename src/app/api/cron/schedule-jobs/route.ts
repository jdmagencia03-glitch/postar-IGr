import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { drainScheduleJobQueue } from "@/lib/schedule-jobs/queue/drain";
import { dispatchQueueDrain } from "@/lib/schedule-jobs/dispatch";
import {
  checkScheduleJobsSchema,
  classifyCronError,
  cronErrorResponse,
} from "@/lib/schedule-jobs/health";
import { QUEUE_CRON_MAX_MS } from "@/lib/schedule-jobs/queue/constants";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCronSecret } from "@/lib/security/secrets";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

function unauthorized() {
  return NextResponse.json(
    { ok: false, error: "unauthorized", message: "Invalid or missing Authorization header", processed: 0 },
    { status: 401 },
  );
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  let cronSecret: string;
  try {
    cronSecret = getCronSecret();
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: "env_missing",
        message: err instanceof Error ? err.message : "CRON_SECRET not configured",
        processed: 0,
      },
      { status: 503 },
    );
  }

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return unauthorized();
  }

  const recalcJobId =
    request.nextUrl.searchParams.get("recalculateWarmupJob") ??
    process.env.RECALCULATE_WARMUP_JOB_ID?.trim();
  if (recalcJobId) {
    try {
      const { executeWarmupRecalculate } = await import("@/lib/warmup-recalculate");
      const recalculate = await executeWarmupRecalculate(recalcJobId);
      return NextResponse.json({
        ok: true,
        recalculate,
        message: "warmup recalculate completed",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[cron/schedule-jobs/recalculate-warmup]", message, error);
      return NextResponse.json(
        { ok: false, error: "recalculate_failed", message, recalculateJobId: recalcJobId },
        { status: 500 },
      );
    }
  }

  let supabase;
  try {
    supabase = createAdminClient();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Supabase client failed";
    return NextResponse.json({ ...cronErrorResponse(message), ok: false }, { status: 503 });
  }

  try {
    const schema = await checkScheduleJobsSchema(supabase);
    if (!schema.tableExists || !schema.baseColumnsReady) {
      const { error, action } = classifyCronError(schema.error ?? "schema incomplete");
      return NextResponse.json(
        {
          ok: false,
          error,
          message: schema.error,
          action,
          processed: 0,
        },
        { status: 200 },
      );
    }

    await dispatchQueueDrain("cron-fallback");

    waitUntil(
      drainScheduleJobQueue(supabase, {
        workerPrefix: "cron",
        maxMs: QUEUE_CRON_MAX_MS,
      })
        .then((result) => {
          if (result.errors.length) {
            console.warn("[cron/schedule-jobs]", result);
          } else {
            console.info("[cron/schedule-jobs]", {
              processed: result.processed,
              claimed: result.claimed,
              elapsedMs: result.elapsedMs,
            });
          }
        })
        .catch((error) => {
          console.error("[cron/schedule-jobs]", error);
        }),
    );

    return NextResponse.json(
      {
        ok: true,
        accepted: true,
        processed: 0,
        dispatcher: process.env.INNGEST_EVENT_KEY?.trim() ? "inngest+cron-fallback" : "cron-fallback",
        message: "schedule-jobs drain started in background",
      },
      { status: 200 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha no cron de agendamento";
    const { error: kind, action } = classifyCronError(message);
    console.error("[cron/schedule-jobs]", message, error);
    return NextResponse.json(
      {
        ok: false,
        error: kind,
        message,
        action,
        processed: 0,
        details: message,
      },
      { status: 200 },
    );
  }
}
