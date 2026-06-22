import type { SupabaseClient } from "@supabase/supabase-js";
import { finalizeJobStatusFromDb } from "@/lib/schedule-jobs/repository";
import { processInsertChunkForItems } from "@/lib/schedule-jobs/phases/save-posts";
import { processCaptionTask } from "@/lib/schedule-jobs/phases/captions";
import { processCalendarTask } from "@/lib/schedule-jobs/phases/calendar";
import { SCHEDULE_JOB_SMALL_BATCH_MAX } from "@/lib/schedule-jobs/constants";
import {
  completeSavePostsTaskIfReady,
  completeSavePostsTasksIfReady,
} from "@/lib/schedule-jobs/consistency";
import {
  completeTask,
  failTask,
  getJobByIdAdmin,
  loadItemIdsForPhase,
  maybeMaterializeNextPhase,
} from "@/lib/schedule-jobs/queue/tasks";
import type { ScheduleJobTaskRow } from "@/lib/schedule-jobs/queue/types";
import { logScheduleJobEvent } from "@/lib/schedule-jobs/state";

async function completePendingSaveTasks(
  supabase: SupabaseClient,
  jobId: string,
) {
  const now = new Date().toISOString();
  await supabase
    .from("schedule_job_tasks")
    .update({
      status: "completed",
      locked_by: null,
      lock_until: null,
      completed_at: now,
      updated_at: now,
    })
    .eq("schedule_job_id", jobId)
    .eq("phase", "save_posts")
    .in("status", ["pending", "processing"]);
}

export async function runScheduleTask(
  supabase: SupabaseClient,
  task: ScheduleJobTaskRow,
  workerId: string,
) {
  const job = await getJobByIdAdmin(supabase, task.schedule_job_id);
  if (!job) throw new Error("Job não encontrado");
  if (job.status === "cancelled" || job.status === "completed") {
    await completeTask(supabase, task.id, workerId);
    return;
  }

  try {
    if (task.phase === "captions") {
      await processCaptionTask(supabase, task.owner_id, job, task.item_ids);
    } else if (task.phase === "calendar") {
      await processCalendarTask(supabase, task.owner_id, job, task.item_ids);
    } else {
      await processInsertChunkForItems(supabase, task.owner_id, job, task.item_ids);
      await finalizeJobStatusFromDb(supabase, job);
    }

    await completeTask(supabase, task.id, workerId);

    const refreshed = await getJobByIdAdmin(supabase, job.id);
    if (refreshed) {
      const materialized = await maybeMaterializeNextPhase(supabase, refreshed, task.phase);

      if (
        task.phase === "calendar" &&
        refreshed.total_items <= SCHEDULE_JOB_SMALL_BATCH_MAX &&
        materialized
      ) {
        const saveItemIds = await loadItemIdsForPhase(supabase, refreshed.id, "save_posts");
        if (saveItemIds.length) {
          await processInsertChunkForItems(supabase, task.owner_id, refreshed, saveItemIds);
          await completeSavePostsTasksIfReady(supabase, refreshed.id);
          await finalizeJobStatusFromDb(supabase, refreshed);
        }
      }

      if (task.phase === "save_posts") {
        await finalizeJobStatusFromDb(supabase, refreshed);
      }
      logScheduleJobEvent("schedule-job-worker", refreshed, {
        taskId: task.id,
        phase: task.phase,
      });
    }

    console.info("[schedule-job-worker]", {
      taskId: task.id,
      jobId: job.id,
      phase: task.phase,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha no chunk";
    await failTask(supabase, task, workerId, message);
    throw error;
  }
}
