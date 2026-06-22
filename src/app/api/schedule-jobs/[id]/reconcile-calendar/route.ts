import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/meta/oauth";
import { buildJobStatusReadOnly, getScheduleJobHeader } from "@/lib/schedule-jobs/repository";
import { safeReconcileJobFromCalendarPosts } from "@/lib/schedule-jobs/reconcile-calendar";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const RECONCILE_TIMEOUT_MS = 10_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`reconcile_timeout:${label}`));
    }, ms);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

/** Reconcilia job com posts já existentes no calendário (operação pesada). */
export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;

  try {
    const ownerId = await getSessionUserId();
    if (!ownerId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

    const supabase = createAdminClient();
    const job = await getScheduleJobHeader(supabase, ownerId, id);
    if (!job) return NextResponse.json({ error: "Job não encontrado" }, { status: 404 });

    let reconcileResult;
    try {
      reconcileResult = await withTimeout(
        safeReconcileJobFromCalendarPosts(supabase, job),
        RECONCILE_TIMEOUT_MS,
        id,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[schedule-job-reconcile-failed]", { jobId: id, error: message });
      const status = await buildJobStatusReadOnly(supabase, job);
      return NextResponse.json(
        {
          ...status,
          reconcileError: true,
          reconcileErrorMessage: message,
          recommendedAction: "manual_reconcile",
        },
        { status: 200, headers: { "Cache-Control": "no-store" } },
      );
    }

    const status = await buildJobStatusReadOnly(supabase, reconcileResult.job);

    if (reconcileResult.error) {
      return NextResponse.json(
        {
          ...status,
          reconcileError: true,
          reconcileErrorMessage: reconcileResult.error,
          recommendedAction: "manual_reconcile",
        },
        { status: 200, headers: { "Cache-Control": "no-store" } },
      );
    }

    return NextResponse.json(
      {
        ...status,
        reconciled: reconcileResult.reconciled,
        reconcileError: false,
      },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[schedule-job-reconcile-route-failed]", { jobId: id, error: message });
    return NextResponse.json(
      {
        ok: false,
        jobId: id,
        reconcileError: true,
        reconcileErrorMessage: message,
        recommendedAction: "manual_reconcile",
      },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  }
}
