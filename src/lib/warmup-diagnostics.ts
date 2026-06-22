import {
  buildWarmupDiagnosticsPlannedPosts,
  buildWarmupSchedulePlan,
  detectInvalidWarmupSlots,
  resolveWarmupScheduleContext,
  type WarmupDiagnosticsPlannedPost,
  type WarmupInvalidSlotReport,
} from "@/lib/account-warmup";
import { APP_TIMEZONE } from "@/lib/timezone";
import type { ScheduleJobItemRow, ScheduleJobRow } from "@/lib/schedule-jobs/types";

export type WarmupJobDiagnostics = {
  scheduleMode: "warmup";
  timezone: string;
  warmupStartDate: string;
  nowUsedForPlanning: string;
  existingValidPostsToday?: number;
  remainingSlotsToday?: number;
  effectiveFirstScheduledDate?: string | null;
  plannedPosts: WarmupDiagnosticsPlannedPost[];
  invalidSlots: WarmupInvalidSlotReport[];
  createdPosts: Array<{ id: string; scheduledAt: string; status: string }>;
  calendarPosts: Array<{ id: string; scheduledAt: string; status: string }>;
};

export function buildWarmupJobDiagnostics(params: {
  job: ScheduleJobRow;
  items: ScheduleJobItemRow[];
  createdPosts: Array<{ id: string; scheduledAt: string; status: string }>;
  now?: Date;
}): WarmupJobDiagnostics | null {
  if (params.job.schedule_mode !== "warmup") return null;

  const now = params.now ?? new Date();
  const schedulePlan = params.job.config?.schedule_plan;
  const warmupStartDate =
    schedulePlan?.warmupStartDate ??
    resolveWarmupScheduleContext({
      strategy: params.job.config?.schedule_strategy ?? "new_plan",
      now,
    }).warmupStartDate;

  const plannedFromConfig = schedulePlan?.plannedPosts ?? [];
  const plannedSchedule = plannedFromConfig.length
    ? plannedFromConfig.map((post) => new Date(post.scheduledAt))
    : params.items
        .flatMap((item) => (item.destinations ?? []).map((dest) => dest.scheduled_at))
        .filter(Boolean)
        .map((iso) => new Date(iso as string));

  const plannedPosts =
    plannedSchedule.length > 0
      ? buildWarmupDiagnosticsPlannedPosts(plannedSchedule, warmupStartDate)
      : [];

  const pendingPosts = params.createdPosts.filter((post) =>
    ["pending", "processing", "retrying"].includes(post.status),
  );
  const calendarPosts = params.createdPosts;

  const invalidFromPlanned = detectInvalidWarmupSlots(
    plannedPosts.map((post) => post.scheduledAt),
    warmupStartDate,
  );
  const invalidFromCalendar = detectInvalidWarmupSlots(
    pendingPosts.map((post) => post.scheduledAt),
    warmupStartDate,
  );

  const invalidSlots = [...invalidFromPlanned, ...invalidFromCalendar].filter(
    (slot, index, list) =>
      list.findIndex((entry) => entry.scheduledAt === slot.scheduledAt) === index,
  );

  return {
    scheduleMode: "warmup",
    timezone: schedulePlan?.timezone ?? APP_TIMEZONE,
    warmupStartDate,
    nowUsedForPlanning: schedulePlan?.nowUsedForPlanning ?? now.toISOString(),
    existingValidPostsToday: schedulePlan?.planningMeta?.existingValidPostsToday,
    remainingSlotsToday: schedulePlan?.planningMeta?.remainingSlotsToday,
    effectiveFirstScheduledDate: schedulePlan?.planningMeta?.effectiveFirstScheduledDate ?? null,
    plannedPosts,
    invalidSlots,
    createdPosts: params.createdPosts,
    calendarPosts,
  };
}

export type WarmupRecalculateResult = {
  ok: true;
  warmupStartDate: string;
  updated: number;
  before: Array<{ postId: string; scheduledAt: string }>;
  after: Array<{ postId: string; scheduledAt: string }>;
};

export function buildWarmupRecalculatePlan(params: {
  pendingCount: number;
  strategy: "continue" | "new_plan" | "fill_gaps";
  anchorStartDate?: Date;
  now?: Date;
}) {
  const now = params.now ?? new Date();
  const context = resolveWarmupScheduleContext({
    strategy: params.strategy,
    anchorStartDate: params.anchorStartDate,
    now,
  });
  const plan = buildWarmupSchedulePlan({
    count: params.pendingCount,
    warmupDayOffset: context.warmupDayOffset,
    firstScheduledAt: context.firstScheduledAt,
    now,
  });
  return { context, plan };
}
