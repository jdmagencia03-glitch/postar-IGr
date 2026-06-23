import { NextRequest, NextResponse } from "next/server";
import { authorizeCronRequest } from "@/lib/admin/cron-auth";
import {
  apiSessionErrorResponse,
  requireApiSessionSafe,
} from "@/lib/auth/api-session";
import { buildJobStatusReadOnly, getScheduleJobHeader } from "@/lib/schedule-jobs/repository";
import type { ScheduleJobRow } from "@/lib/schedule-jobs/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { withHardTimeout, DB_ROUTE_TIMEOUT_MS } from "@/lib/with-timeout";

const ROUTE = "/api/schedule-jobs/[id]/status";
const DB_TIMEOUT_SENTINEL = "__db_timeout__" as const;
type JobLookupResult = ScheduleJobRow | null | typeof DB_TIMEOUT_SENTINEL;

export const dynamic = "force-dynamic";
export const maxDuration = 15;

function statusErrorResponse(jobId: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const dbTimeout = message === "db_timeout";
  console.error("[schedule-job-status-failed]", { jobId, error: message });
  return NextResponse.json(
    {
      ok: false,
      jobId,
      status: "unknown",
      phase: "status_error",
      statusError: true,
      statusErrorMessage: dbTimeout ? "Banco temporariamente lento" : message,
      error: dbTimeout ? "db_timeout" : "status_error",
      message: dbTimeout ? "Banco temporariamente lento" : message,
      recommendedAction: "manual_review",
      data: null,
    },
    { status: dbTimeout ? 503 : 200, headers: { "Cache-Control": "no-store" } },
  );
}

/** Leitura rápida de status — sem reconciliação pesada (use POST reconcile-calendar). */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;

  try {
    const cronAuthorized = authorizeCronRequest(request);
    let ownerId: string | null = null;

    if (!cronAuthorized) {
      const session = await requireApiSessionSafe(ROUTE);
      if (!session.ok) {
        return apiSessionErrorResponse(session, null);
      }
      ownerId = session.userId;
    }

    const supabase = createAdminClient();
    let job: JobLookupResult = null;
    if (ownerId) {
      job = await withHardTimeout<JobLookupResult>(
        getScheduleJobHeader(supabase, ownerId, id),
        DB_ROUTE_TIMEOUT_MS,
        DB_TIMEOUT_SENTINEL,
        "schedule-job-status-header",
      );
    } else if (cronAuthorized) {
      job = await withHardTimeout<JobLookupResult>(
        (async () => {
          const { data, error } = await supabase
            .from("schedule_jobs")
            .select("id, status, schedule_mode, upload_batch_id, platform, account_id, tiktok_account_id, total_items, completed_items, failed_items, schedule_summary, config, updated_at, error_message, last_heartbeat_at")
            .eq("id", id)
            .maybeSingle();
          if (error) throw new Error(error.message);
          return (data as ScheduleJobRow | null) ?? null;
        })(),
        DB_ROUTE_TIMEOUT_MS,
        DB_TIMEOUT_SENTINEL,
        "schedule-job-status-cron-header",
      );
    }

    if (job === DB_TIMEOUT_SENTINEL) {
      return statusErrorResponse(id, new Error("db_timeout"));
    }
    if (!job) return NextResponse.json({ error: "Job não encontrado" }, { status: 404 });

    const status = await withHardTimeout(
      buildJobStatusReadOnly(supabase, job),
      DB_ROUTE_TIMEOUT_MS,
      null,
      "schedule-job-status-readonly",
    );

    if (status === null) {
      return statusErrorResponse(id, new Error("db_timeout"));
    }

    return NextResponse.json(status, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("[api-handler-failed]", { route: ROUTE, jobId: id, error });
    return statusErrorResponse(id, error);
  }
}
