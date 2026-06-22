import {
  buildWarmupDiagnosticsPlannedPosts,
  buildWarmupSchedulePlan,
  detectInvalidWarmupSlots,
  getWarmupDailyPostLimit,
  resolveWarmupScheduleContext,
  type WarmupDiagnosticsPlannedPost,
  type WarmupInvalidSlotReport,
  type WarmupPlanningMeta,
} from "@/lib/account-warmup";
import {
  buildExistingValidPostsByLocalDate,
  buildWarmupCapacityDiagnostics,
  enumerateLocalDatesFromAnchor,
  type WarmupCapacityDaySnapshot,
} from "@/lib/posts/warmup-capacity";
import { APP_TIMEZONE } from "@/lib/timezone";
import type { ContentType, SocialPlatform } from "@/lib/types";
import type { ScheduleJobItemRow, ScheduleJobRow } from "@/lib/schedule-jobs/types";
import type { SupabaseClient } from "@supabase/supabase-js";

export type WarmupJobDiagnostics = {
  scheduleMode: "warmup";
  timezone: string;
  warmupStartDate: string;
  nowUsedForPlanning: string;
  existingValidPostsToday?: number;
  remainingSlotsToday?: number;
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

  const planningMeta = schedulePlan?.planningMeta;

  return {
    scheduleMode: "warmup",
    timezone: schedulePlan?.timezone ?? APP_TIMEZONE,
    warmupStartDate,
    nowUsedForPlanning: schedulePlan?.nowUsedForPlanning ?? now.toISOString(),
    existingValidPostsToday: planningMeta?.existingValidPostsToday,
    remainingSlotsToday: planningMeta?.remainingSlotsToday,
    effectiveFirstScheduledDate: planningMeta?.effectiveFirstScheduledDate ?? null,
    reasonFirstDateSkipped: planningMeta?.reasonFirstDateSkipped ?? null,
    existingValidPostsByDate: planningMeta?.existingValidPostsByDate,
    ignoredStatusesByDate: planningMeta?.ignoredStatusesByDate,
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
  planningMeta: WarmupPlanningMeta | null;
};

export async function buildWarmupRecalculatePlan(params: {
  supabase: SupabaseClient;
  accountId: string;
  platform: SocialPlatform;
  contentType?: ContentType;
  pendingCount: number;
  excludePostIds?: string[];
  now?: Date;
}) {
  const now = params.now ?? new Date();
  const context = resolveWarmupScheduleContext({
    strategy: "new_plan",
    now,
  });
  const planningDays = Math.min(Math.max(params.pendingCount * 2, 14), 35);
  const planningDates = enumerateLocalDatesFromAnchor(context.warmupStartDate, planningDays);
  const existingValidPostsByLocalDate = await buildExistingValidPostsByLocalDate(params.supabase, {
    accountId: params.accountId,
    platform: params.platform,
    contentType: params.contentType,
    localDates: planningDates,
    excludePostIds: params.excludePostIds,
  });
  const capacityDiagnostics = await buildWarmupCapacityDiagnostics(params.supabase, {
    accountId: params.accountId,
    platform: params.platform,
    contentType: params.contentType,
    localDates: planningDates.slice(0, 7),
    warmupStartDate: context.warmupStartDate,
    dailyLimitForRampDay: getWarmupDailyPostLimit,
    excludePostIds: params.excludePostIds,
  });
  const plan = buildWarmupSchedulePlan({
    count: params.pendingCount,
    warmupDayOffset: context.warmupDayOffset,
    firstScheduledAt: context.firstScheduledAt,
    now,
    existingValidPostsByLocalDate,
  });
  const planningMeta = plan.planningMeta
    ? {
        ...plan.planningMeta,
        existingValidPostsByDate: capacityDiagnostics.existingValidPostsByDate.map((entry) => ({
          date: entry.date,
          validCount: entry.validCount,
          cancelledCount: entry.cancelledCount,
          limit: entry.limit,
          remaining: entry.remaining,
        })),
        ignoredStatusesByDate: capacityDiagnostics.ignoredStatusesByDate,
      }
    : null;
  return { context, plan, planningMeta };
}
