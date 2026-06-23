import { randomUUID } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { contentTypeForPlatform } from "@/lib/content-types";
import { TIKTOK_SCHEDULE_OFFSET_MINUTES } from "@/lib/multiplatform/types";
import { buildScheduleWithInsertion } from "@/lib/schedule-insertion";
import {
  resolveJobPlanningContext,
  resolveWarmup,
} from "@/lib/schedule-jobs/phases/context";
import { buildPipelinePatch } from "@/lib/schedule-jobs/item-pipeline";
import { updateJobCounters, updateJobItem } from "@/lib/schedule-jobs/repository";
import { logScheduleJobEvent } from "@/lib/schedule-jobs/state";
import type {
  ScheduleJobDestination,
  ScheduleJobItemRow,
  ScheduleJobRow,
} from "@/lib/schedule-jobs/types";
import { WARMUP_PATTERN } from "@/lib/account-warmup";
import { APP_TIMEZONE } from "@/lib/timezone";
import { buildWarmupScheduleSummary } from "@/lib/schedule-plan";
import {
  describeSmartSchedule,
  ensureFutureScheduleSlot,
  resolveAutoPostsPerDay,
} from "@/lib/smart-schedule";

function scheduleForPlatform(
  baseSchedule: Date[],
  platform: "instagram" | "tiktok",
  now = new Date(),
  preserveWarmupSlots = false,
) {
  const offsetMs = platform === "tiktok" ? TIKTOK_SCHEDULE_OFFSET_MINUTES * 60_000 : 0;
  if (preserveWarmupSlots && offsetMs === 0) {
    return baseSchedule.map((slot) => new Date(slot));
  }
  return baseSchedule.map((slot) =>
    ensureFutureScheduleSlot(new Date(slot.getTime() + offsetMs), now),
  );
}

async function planCalendarForItem(params: {
  supabase: SupabaseClient;
  ownerId: string;
  job: ScheduleJobRow;
  item: ScheduleJobItemRow;
  ctx: Awaited<ReturnType<typeof resolveJobPlanningContext>>;
  now: Date;
}) {
  const { supabase, job, item, ctx, now } = params;
  const preserveWarmupSlots = ctx.scheduleMode === "warmup";

  const insertion = await buildScheduleWithInsertion({
    supabase,
    platform: ctx.insertionTarget.platform,
    accountId: ctx.insertionTarget.account_id,
    contentType: contentTypeForPlatform(ctx.insertionTarget.platform),
    mode: ctx.scheduleMode,
    strategy: ctx.config.schedule_strategy,
    count: 1,
    batchOffset: item.sort_order,
    totalCount: job.total_items,
    uploadBatchId: job.upload_batch_id,
    clientBatchScheduledCount: ctx.config.batch_scheduled_count ?? 0,
    warmup: resolveWarmup(ctx.scheduleMode, ctx.insertionTarget.platform, ctx.primaryAccount),
    auto: ctx.auto,
    custom: ctx.custom,
    now,
  });

  const schedule = insertion.schedule;
  if (!schedule.length) {
    throw new Error("Não foi possível calcular o horário para este vídeo.");
  }

  const parent_publish_group_id = randomUUID();
  const destinations: ScheduleJobDestination[] = ctx.targets.map((target) => {
    const platformSchedule = scheduleForPlatform(
      schedule,
      target.platform,
      now,
      preserveWarmupSlots,
    );
    return {
      platform: target.platform,
      account_id: target.account_id,
      caption: item.caption ?? "",
      scheduled_at: platformSchedule[0]!.toISOString(),
      created_post_id: null,
    };
  });

  await updateJobItem(supabase, item.id, {
    ...buildPipelinePatch(item, {}),
    status: "processing",
    destinations,
    parent_publish_group_id,
    scheduled_at: destinations[0]?.scheduled_at ?? null,
  });

  return insertion;
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
  const now = new Date();
  let planned = 0;
  let failed = 0;
  let lastInsertion: Awaited<ReturnType<typeof buildScheduleWithInsertion>> | null = null;

  for (const item of pending) {
    try {
      lastInsertion = await planCalendarForItem({
        supabase,
        ownerId,
        job,
        item,
        ctx,
        now,
      });
      planned += 1;
    } catch (err) {
      failed += 1;
      const message = err instanceof Error ? err.message : "Falha ao planejar calendário";
      await updateJobItem(supabase, item.id, {
        status: "retrying",
        error_message: message,
        attempt_count: item.attempt_count + 1,
      });
    }
  }

  const shouldWriteSummary =
  lastInsertion &&
    (!job.schedule_summary ||
      (ctx.scheduleMode === "warmup" && job.schedule_summary.includes("posts/dia")));

  if (shouldWriteSummary && lastInsertion) {
    const schedule_summary =
      ctx.scheduleMode === "warmup"
        ? buildWarmupScheduleSummary({
            schedule: lastInsertion.totalSchedule,
            count: job.total_items,
            skippedPastSlots: lastInsertion.skippedPastSlots,
          })
        : `${resolveAutoPostsPerDay(job.total_items, ctx.auto?.profile ?? "growing")} posts/dia · ${describeSmartSchedule(lastInsertion.totalSchedule, "auto")}`;

    const configPatch = {
      ...job.config,
      schedule_plan: {
        warmupPattern: ctx.scheduleMode === "warmup" ? WARMUP_PATTERN : null,
        warmupStartDate: lastInsertion.warmupStartDate ?? null,
        timezone: APP_TIMEZONE,
        nowUsedForPlanning: now.toISOString(),
        skippedPastSlots: lastInsertion.skippedPastSlots ?? [],
        plannedPosts: lastInsertion.plannedPosts ?? [],
        planningMeta: lastInsertion.warmupPlanningMeta ?? null,
      },
    };

    await updateJobCounters(supabase, job.id, {
      schedule_summary,
      config: configPatch,
      status: "processing",
      current_step: "captions",
    } as Partial<ScheduleJobRow>);
  }

  logScheduleJobEvent("schedule-job-chunk", job, {
    phase: "calendar",
    count: pending.length,
    planned,
    failed,
  });

  console.info("[schedule-job-chunk]", {
    jobId: job.id,
    phase: "calendar",
    items: pending.length,
    planned,
    failed,
  });
}
