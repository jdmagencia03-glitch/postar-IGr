import { randomUUID } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { contentTypeForPlatform } from "@/lib/content-types";
import { TIKTOK_SCHEDULE_OFFSET_MINUTES } from "@/lib/multiplatform/types";
import { buildScheduleWithInsertion } from "@/lib/schedule-insertion";
import {
  accountUsername,
  resolveJobPlanningContext,
  resolveWarmup,
} from "@/lib/schedule-jobs/phases/context";
import { updateJobCounters, updateJobItem } from "@/lib/schedule-jobs/repository";
import { logScheduleJobEvent } from "@/lib/schedule-jobs/state";
import type {
  ScheduleJobDestination,
  ScheduleJobItemRow,
  ScheduleJobRow,
} from "@/lib/schedule-jobs/types";
import {
  describeSmartSchedule,
  ensureFutureScheduleSlot,
  resolveAutoPostsPerDay,
} from "@/lib/smart-schedule";

function scheduleForPlatform(baseSchedule: Date[], platform: "instagram" | "tiktok", now = new Date()) {
  const offsetMs = platform === "tiktok" ? TIKTOK_SCHEDULE_OFFSET_MINUTES * 60_000 : 0;
  return baseSchedule.map((slot) =>
    ensureFutureScheduleSlot(new Date(slot.getTime() + offsetMs), now),
  );
}

export async function processCalendarTask(
  supabase: SupabaseClient,
  ownerId: string,
  job: ScheduleJobRow,
  itemIds: string[],
) {
  if (!itemIds.length) return;

  const { data, error } = await supabase
    .from("schedule_job_items")
    .select("*")
    .eq("schedule_job_id", job.id)
    .in("id", itemIds)
    .order("sort_order", { ascending: true });

  if (error) throw new Error(error.message);

  const items = (data ?? []) as ScheduleJobItemRow[];
  const pending = items.filter((item) => item.caption?.trim() && !item.destinations?.length);
  if (!pending.length) return;

  const ctx = await resolveJobPlanningContext(supabase, ownerId, job);
  const batchOffset = job.processed_items;
  const now = new Date();

  const insertion = await buildScheduleWithInsertion({
    supabase,
    platform: ctx.insertionTarget.platform,
    accountId: ctx.insertionTarget.account_id,
    contentType: contentTypeForPlatform(ctx.insertionTarget.platform),
    mode: ctx.scheduleMode,
    strategy: ctx.config.schedule_strategy,
    count: pending.length,
    batchOffset,
    totalCount: job.total_items,
    uploadBatchId: job.upload_batch_id,
    clientBatchScheduledCount: ctx.config.batch_scheduled_count ?? 0,
    warmup: resolveWarmup(ctx.scheduleMode, ctx.insertionTarget.platform, ctx.primaryAccount),
    auto: ctx.auto,
    custom: ctx.custom,
    now,
  });

  const schedule = insertion.schedule;
  if (schedule.length < pending.length) {
    throw new Error("Não foi possível calcular os horários para este chunk.");
  }

  for (let index = 0; index < pending.length; index++) {
    const item = pending[index]!;
    const parent_publish_group_id = randomUUID();
    const destinations: ScheduleJobDestination[] = ctx.targets.map((target) => {
      const account = ctx.accounts.get(target.account_id)!;
      const platformSchedule = scheduleForPlatform(schedule, target.platform, now);
      return {
        platform: target.platform,
        account_id: target.account_id,
        caption: item.caption ?? "",
        scheduled_at: platformSchedule[index]!.toISOString(),
        created_post_id: null,
      };
    });

    await updateJobItem(supabase, item.id, {
      status: "processing",
      destinations,
      parent_publish_group_id,
      scheduled_at: destinations[0]?.scheduled_at ?? null,
    });
  }

  if (!job.schedule_summary) {
    const postsPerDay =
      ctx.scheduleMode === "custom"
        ? (ctx.custom?.postsPerDay ?? 15)
        : resolveAutoPostsPerDay(job.total_items, ctx.auto?.profile ?? "growing");
    const schedule_summary = `${postsPerDay} posts/dia · ${describeSmartSchedule(insertion.totalSchedule, "auto")}`;

    await updateJobCounters(supabase, job.id, {
      schedule_summary,
      status: "processing",
      current_step: "captions",
    } as Partial<ScheduleJobRow>);
  }

  logScheduleJobEvent("schedule-job-chunk", job, {
    phase: "calendar",
    count: pending.length,
  });

  console.info("[schedule-job-chunk]", {
    jobId: job.id,
    phase: "calendar",
    items: pending.length,
  });
}
