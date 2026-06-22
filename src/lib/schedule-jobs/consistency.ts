import type { SupabaseClient } from "@supabase/supabase-js";
import { loadItemIdsForPhase } from "@/lib/schedule-jobs/queue/tasks";
import { isScheduleJobQueueReady } from "@/lib/schedule-jobs/queue/schema";
import type { ScheduleJobRow, ScheduleJobItemRow } from "@/lib/schedule-jobs/types";
import { buildWarmupJobDiagnostics } from "@/lib/warmup-diagnostics";
import { normalizeWarmupScheduleSummary } from "@/lib/schedule-plan";

export type ConsistencyErrorCode =
  | "save_posts_marked_completed_but_no_posts_saved"
  | "save_posts_completed_but_posts_missing"
  | "save_posts_completed_but_items_pending"
  | "job_completed_but_posts_missing";

export type ConsistencyError = {
  code: ConsistencyErrorCode;
  message: string;
};

export type ScheduleJobRecommendedAction =
  | "cancel_old_job"
  | "finalize_posts"
  | "create_new_job"
  | "manual_review"
  | "manual_reconcile"
  | "reconcile_calendar"
  | "resume"
  | "wait"
  | "completed";

export type JobConsistencySnapshot = {
  postsInCalendar: number;
  pendingSaveItems: number;
  savePostsTasksCompleted: number;
  savePostsTasksTotal: number;
  errors: ConsistencyError[];
  isInconsistent: boolean;
  recommendedAction: ScheduleJobRecommendedAction | null;
};

export type JobDiagnosticsEnrichment = {
  scheduleMode: string | null;
  warmupPattern: string | null;
  scheduleSummary: string | null;
  timezone?: string | null;
  nowUsedForPlanning?: string | null;
  warmupStartDate?: string | null;
  existingValidPostsToday?: number | null;
  remainingSlotsToday?: number | null;
  effectiveFirstScheduledDate?: string | null;
  reasonFirstDateSkipped?: string | null;
  existingValidPostsByDate?: Array<{
    date: string;
    validCount: number;
    cancelledCount: number;
    limit: number;
    remaining: number;
  }>;
  ignoredStatusesByDate?: Record<string, { cancelled?: number; failed_persistent?: number; needs_media?: number }>;
  plannedPosts: Array<{
    dayIndex: number;
    scheduledAt: string;
    slot: string;
    slotSource: "warmup_fixed";
    localDate?: string;
    localTime?: string;
    isValidWarmupSlot?: boolean;
  }>;
  invalidSlots?: Array<{
    scheduledAt: string;
    localTime: string;
    dayIndex: number;
    reason: "not_in_warmup_fixed_grid";
  }>;
  createdPosts: Array<{ id: string; scheduledAt: string; status: string }>;
  calendarPosts?: Array<{ id: string; scheduledAt: string; status: string }>;
  missingPosts: Array<{ itemId: string; filename: string; reason: string }>;
  duplicates: Array<{ scheduledAt: string; count: number }>;
  consistencyErrors: ConsistencyError[];
  recommendedAction: ScheduleJobRecommendedAction | null;
  canDiscardJob: boolean;
};

function plannedPostsFromItems(items: ScheduleJobItemRow[]) {
  return items
    .flatMap((item) =>
      (item.destinations ?? []).map((dest) => ({
        itemId: item.id,
        filename: item.filename,
        scheduledAt: dest.scheduled_at,
      })),
    )
    .filter((row) => row.scheduledAt)
    .map((row, index) => ({
      dayIndex: index + 1,
      scheduledAt: row.scheduledAt,
      slot: new Date(row.scheduledAt).toLocaleTimeString("pt-BR", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "America/Sao_Paulo",
      }),
      slotSource: "warmup_fixed" as const,
    }));
}

function isLegacyCorruptWarmupSummary(summary: string | null | undefined) {
  if (!summary) return false;
  return /7\s*posts\/dia/i.test(summary) || /posts\/dia/i.test(summary);
}

export async function areSavePostsItemsComplete(
  supabase: SupabaseClient,
  jobId: string,
  itemIds: string[],
) {
  if (!itemIds.length) return true;

  const { data, error } = await supabase
    .from("schedule_job_items")
    .select("id, status, created_post_id")
    .eq("schedule_job_id", jobId)
    .in("id", itemIds);

  if (error) throw new Error(error.message);

  const byId = new Map((data ?? []).map((row) => [row.id as string, row]));
  return itemIds.every((id) => {
    const item = byId.get(id);
    return item?.status === "completed" && Boolean(item.created_post_id);
  });
}

/** Reabre tasks save_posts marcadas completed sem posts salvos. */
export async function repairSavePostsTaskConsistency(
  supabase: SupabaseClient,
  jobId: string,
): Promise<number> {
  if (!(await isScheduleJobQueueReady(supabase))) return 0;

  const { data: tasks, error } = await supabase
    .from("schedule_job_tasks")
    .select("id, item_ids, status")
    .eq("schedule_job_id", jobId)
    .eq("phase", "save_posts")
    .eq("status", "completed");

  if (error) throw new Error(error.message);
  if (!tasks?.length) return 0;

  const now = new Date().toISOString();
  let reopened = 0;

  for (const task of tasks) {
    const itemIds = (task.item_ids as string[]) ?? [];
    const ready = await areSavePostsItemsComplete(supabase, jobId, itemIds);
    if (ready) continue;

    const { error: updateError } = await supabase
      .from("schedule_job_tasks")
      .update({
        status: "pending",
        locked_by: null,
        lock_until: null,
        completed_at: null,
        updated_at: now,
      })
      .eq("id", task.id);

    if (!updateError) reopened += 1;
  }

  if (reopened > 0) {
    console.info("[schedule-job-consistency]", {
      jobId,
      reopenedSaveTasks: reopened,
    });
  }

  return reopened;
}

export async function completeSavePostsTaskIfReady(
  supabase: SupabaseClient,
  taskId: string,
  jobId: string,
  itemIds: string[],
  workerId: string,
): Promise<boolean> {
  const ready = await areSavePostsItemsComplete(supabase, jobId, itemIds);
  const now = new Date().toISOString();

  if (ready) {
    await supabase
      .from("schedule_job_tasks")
      .update({
        status: "completed",
        locked_by: null,
        lock_until: null,
        completed_at: now,
        updated_at: now,
      })
      .eq("id", taskId)
      .eq("locked_by", workerId);
    return true;
  }

  await supabase
    .from("schedule_job_tasks")
    .update({
      status: "pending",
      locked_by: null,
      lock_until: null,
      completed_at: null,
      updated_at: now,
    })
    .eq("id", taskId)
    .eq("locked_by", workerId);

  return false;
}

/** Marca como completed apenas tasks save_posts cujos itens foram salvos. */
export async function completeSavePostsTasksIfReady(
  supabase: SupabaseClient,
  jobId: string,
): Promise<{ completed: number; reopened: number }> {
  const { data: tasks, error } = await supabase
    .from("schedule_job_tasks")
    .select("id, item_ids, status")
    .eq("schedule_job_id", jobId)
    .eq("phase", "save_posts")
    .in("status", ["pending", "processing"]);

  if (error) throw new Error(error.message);
  if (!tasks?.length) return { completed: 0, reopened: 0 };

  const now = new Date().toISOString();
  let completed = 0;
  let reopened = 0;

  for (const task of tasks) {
    const itemIds = (task.item_ids as string[]) ?? [];
    const ready = await areSavePostsItemsComplete(supabase, jobId, itemIds);

    if (ready) {
      await supabase
        .from("schedule_job_tasks")
        .update({
          status: "completed",
          locked_by: null,
          lock_until: null,
          completed_at: now,
          updated_at: now,
        })
        .eq("id", task.id);
      completed += 1;
    } else if (task.status === "processing") {
      await supabase
        .from("schedule_job_tasks")
        .update({
          status: "pending",
          locked_by: null,
          lock_until: null,
          updated_at: now,
        })
        .eq("id", task.id);
      reopened += 1;
    }
  }

  return { completed, reopened };
}

export async function loadJobConsistencySnapshot(
  supabase: SupabaseClient,
  job: ScheduleJobRow,
): Promise<JobConsistencySnapshot> {
  const queueReady = await isScheduleJobQueueReady(supabase);

  let postsInCalendar = 0;
  if (job.upload_batch_id) {
    const { count } = await supabase
      .from("scheduled_posts")
      .select("id", { count: "exact", head: true })
      .eq("upload_batch_id", job.upload_batch_id);
    postsInCalendar = count ?? 0;
  }

  const pendingSaveItems = queueReady
    ? (await loadItemIdsForPhase(supabase, job.id, "save_posts")).length
    : Math.max(0, job.total_items - job.completed_items - job.failed_items);

  let savePostsTasksCompleted = 0;
  let savePostsTasksTotal = 0;

  if (queueReady) {
    const { data: tasks } = await supabase
      .from("schedule_job_tasks")
      .select("status")
      .eq("schedule_job_id", job.id)
      .eq("phase", "save_posts")
      .neq("status", "cancelled");

    for (const task of tasks ?? []) {
      savePostsTasksTotal += 1;
      if (task.status === "completed") savePostsTasksCompleted += 1;
    }
  }

  const errors: ConsistencyError[] = [];
  const allPostsInCalendar =
    postsInCalendar >= job.total_items && job.total_items > 0;

  if (allPostsInCalendar) {
    const needsReconcile =
      job.status !== "completed" && job.status !== "partial_failed";
    return {
      postsInCalendar,
      pendingSaveItems,
      savePostsTasksCompleted,
      savePostsTasksTotal,
      errors: [],
      isInconsistent: false,
      recommendedAction: needsReconcile
        ? "reconcile_calendar"
        : "completed",
    };
  }

  const savePostsMarkedDone = savePostsTasksCompleted > 0;
  const allPostsSaved =
    job.completed_items === job.total_items &&
    pendingSaveItems === 0 &&
    postsInCalendar >= job.total_items;

  if (savePostsMarkedDone && postsInCalendar === 0 && job.total_items > 0) {
    errors.push({
      code: "save_posts_marked_completed_but_no_posts_saved",
      message: "save_posts está completed, mas postsInCalendar é 0.",
    });
  } else if (savePostsMarkedDone && postsInCalendar < job.total_items) {
    errors.push({
      code: "save_posts_completed_but_posts_missing",
      message: `save_posts está completed, mas apenas ${postsInCalendar} de ${job.total_items} posts estão no calendário.`,
    });
  }

  if (savePostsMarkedDone && pendingSaveItems > 0) {
    errors.push({
      code: "save_posts_completed_but_items_pending",
      message: `save_posts está completed, mas ${pendingSaveItems} item(ns) ainda aguardam salvamento.`,
    });
  }

  if (
    (job.status === "completed" || job.status === "partial_failed") &&
    postsInCalendar < job.completed_items
  ) {
    errors.push({
      code: "job_completed_but_posts_missing",
      message: "Job marcado como concluído, mas faltam posts no calendário.",
    });
  }

  const isInconsistent = errors.length > 0;

  let recommendedAction: ScheduleJobRecommendedAction | null = null;
  if (job.status === "completed" && !isInconsistent) {
    recommendedAction = "completed";
  } else if (job.status === "cancelled") {
    recommendedAction = "create_new_job";
  } else if (isInconsistent) {
    if (postsInCalendar === 0 && pendingSaveItems > 0 && savePostsMarkedDone) {
      recommendedAction = isLegacyCorruptWarmupSummary(job.schedule_summary)
        ? "cancel_old_job"
        : "finalize_posts";
    } else if (postsInCalendar === 0 && pendingSaveItems > 0) {
      recommendedAction = "finalize_posts";
    } else {
      recommendedAction = "manual_review";
    }
  } else if (pendingSaveItems > 0 && job.processed_items >= job.total_items) {
    recommendedAction = "finalize_posts";
  } else if (job.status === "failed" || job.status === "partial_failed") {
    recommendedAction = "resume";
  }

  if (!recommendedAction && !allPostsSaved && job.processed_items >= job.total_items) {
    recommendedAction = "finalize_posts";
  }

  return {
    postsInCalendar,
    pendingSaveItems,
    savePostsTasksCompleted,
    savePostsTasksTotal,
    errors,
    isInconsistent,
    recommendedAction,
  };
}

export function applyConsistencyToView<
  T extends {
    isStalled: boolean;
    stalledReason: string | null;
    recommendedAction: string | null;
    canForceContinue: boolean;
    canFinalizePosts: boolean;
    canCancel: boolean;
    canResume: boolean;
    hasActiveError: boolean;
    phase: string;
  },
>(view: T, consistency: JobConsistencySnapshot, job: ScheduleJobRow): T {
  if (!consistency.isInconsistent) return view;

  return {
    ...view,
    isStalled: true,
    stalledReason: consistency.errors[0]?.code ?? "save_posts_inconsistent",
    recommendedAction: consistency.recommendedAction ?? "finalize_posts",
    canForceContinue: true,
    canFinalizePosts: consistency.postsInCalendar < job.total_items,
    canCancel: true,
    canResume: true,
    hasActiveError: true,
    phase: view.phase === "saving_posts" ? view.phase : "paused_needs_action",
  };
}

export async function buildJobDiagnosticsEnrichment(
  supabase: SupabaseClient,
  job: ScheduleJobRow,
  items: ScheduleJobItemRow[],
  consistency: JobConsistencySnapshot,
): Promise<JobDiagnosticsEnrichment> {
  const schedulePlan = job.config?.schedule_plan;
  const plannedPosts =
    schedulePlan?.plannedPosts?.length ? schedulePlan.plannedPosts : plannedPostsFromItems(items);

  let createdPosts: JobDiagnosticsEnrichment["createdPosts"] = [];
  if (job.upload_batch_id) {
    const { data: posts } = await supabase
      .from("scheduled_posts")
      .select("id, scheduled_at, status")
      .eq("upload_batch_id", job.upload_batch_id);
    createdPosts =
      posts?.map((post) => ({
        id: post.id as string,
        scheduledAt: post.scheduled_at as string,
        status: post.status as string,
      })) ?? [];
  }

  const slotCounts = new Map<string, number>();
  for (const post of createdPosts) {
    slotCounts.set(post.scheduledAt, (slotCounts.get(post.scheduledAt) ?? 0) + 1);
  }
  const duplicates = [...slotCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([scheduledAt, count]) => ({ scheduledAt, count }));

  const createdItemIds = new Set(
    items.filter((item) => item.created_post_id).map((item) => item.id),
  );

  const missingPosts = items
    .filter((item) => !item.created_post_id && item.status !== "failed")
    .map((item) => ({
      itemId: item.id,
      filename: item.filename,
      reason: createdItemIds.has(item.id) ? "post_id_missing" : `item_status_${item.status}`,
    }));

  const canDiscardJob =
    consistency.isInconsistent &&
    consistency.postsInCalendar === 0 &&
    job.status !== "cancelled" &&
    job.status !== "completed";

  const warmupDiagnostics = buildWarmupJobDiagnostics({
    job,
    items,
    createdPosts,
  });

  return {
    scheduleMode: job.schedule_mode ?? null,
    warmupPattern:
      schedulePlan?.warmupPattern ??
      (job.schedule_mode === "warmup" ? "3→3→4→4→7" : null),
    scheduleSummary: normalizeWarmupScheduleSummary(job.schedule_summary),
    timezone: warmupDiagnostics?.timezone ?? schedulePlan?.timezone ?? null,
    nowUsedForPlanning:
      warmupDiagnostics?.nowUsedForPlanning ?? schedulePlan?.nowUsedForPlanning ?? null,
    warmupStartDate:
      warmupDiagnostics?.warmupStartDate ?? schedulePlan?.warmupStartDate ?? null,
    existingValidPostsToday:
      warmupDiagnostics?.existingValidPostsToday ??
      schedulePlan?.planningMeta?.existingValidPostsToday ??
      null,
    remainingSlotsToday:
      warmupDiagnostics?.remainingSlotsToday ??
      schedulePlan?.planningMeta?.remainingSlotsToday ??
      null,
    effectiveFirstScheduledDate:
      warmupDiagnostics?.effectiveFirstScheduledDate ??
      schedulePlan?.planningMeta?.effectiveFirstScheduledDate ??
      null,
    reasonFirstDateSkipped:
      warmupDiagnostics?.reasonFirstDateSkipped ??
      schedulePlan?.planningMeta?.reasonFirstDateSkipped ??
      null,
    existingValidPostsByDate:
      warmupDiagnostics?.existingValidPostsByDate ??
      schedulePlan?.planningMeta?.existingValidPostsByDate ??
      undefined,
    ignoredStatusesByDate:
      warmupDiagnostics?.ignoredStatusesByDate ??
      schedulePlan?.planningMeta?.ignoredStatusesByDate ??
      undefined,
    plannedPosts: warmupDiagnostics?.plannedPosts ?? plannedPosts,
    invalidSlots: warmupDiagnostics?.invalidSlots ?? [],
    createdPosts,
    calendarPosts: warmupDiagnostics?.calendarPosts ?? createdPosts,
    missingPosts,
    duplicates,
    consistencyErrors: consistency.errors,
    recommendedAction: consistency.recommendedAction,
    canDiscardJob,
  };
}
