import type { SupabaseClient } from "@supabase/supabase-js";
import { QUEUE_JOB_STUCK_MS } from "@/lib/schedule-jobs/queue/constants";
import { ensureJobQueueForCurrentPhase } from "@/lib/schedule-jobs/queue/repair";
import { isScheduleJobQueueReady } from "@/lib/schedule-jobs/queue/schema";
import { isWorkerActive, logScheduleJobEvent } from "@/lib/schedule-jobs/state";
import type { ScheduleJobRow } from "@/lib/schedule-jobs/types";
import { reportClientOperationalError } from "@/lib/operations/operational-errors";

export async function recoverStuckScheduleJobs(supabase: SupabaseClient) {
  const cutoff = new Date(Date.now() - QUEUE_JOB_STUCK_MS).toISOString();
  const { data, error } = await supabase
    .from("schedule_jobs")
    .select("*")
    .in("status", ["queued", "processing"])
    .lt("updated_at", cutoff)
    .limit(20);

  if (error) throw new Error(error.message);

  const queueReady = await isScheduleJobQueueReady(supabase);

  for (const row of (data ?? []) as ScheduleJobRow[]) {
    if (isWorkerActive(row)) continue;

    console.warn("[schedule-job-stuck]", { jobId: row.id, updatedAt: row.updated_at });

    await supabase
      .from("schedule_jobs")
      .update({
        locked_by: null,
        lock_until: null,
        error_message: "Job travado detectado — reencaminhado para fila.",
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id);

    if (queueReady) {
      await supabase
        .from("schedule_job_tasks")
        .update({
          status: "pending",
          locked_by: null,
          lock_until: null,
          updated_at: new Date().toISOString(),
        })
        .eq("schedule_job_id", row.id)
        .eq("status", "processing");

      await ensureJobQueueForCurrentPhase(supabase, row);
    }

    logScheduleJobEvent("schedule-job-stuck", row, { recovered: true });

    try {
      await reportClientOperationalError(supabase, row.owner_id, {
        errorType: "schedule_job_stuck",
        title: "Agendamento travado detectado",
        message: `Job ${row.id.slice(0, 8)} foi reencaminhado automaticamente.`,
        probableCause: "Worker interrompido ou timeout.",
        recommendedAction: "Acompanhe o progresso — progresso anterior foi preservado.",
        uploadBatchId: row.upload_batch_id ?? undefined,
        metadata: { jobId: row.id },
      });
    } catch {
      // ignore
    }
  }
}
