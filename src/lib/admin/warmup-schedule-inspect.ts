import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildWarmupRamp,
  DEFAULT_WARMUP_DAYS,
  generateWarmupSchedule,
  resolveWarmupCalendarStart,
  warmupDateKey,
} from "@/lib/account-warmup";
import { TIKTOK_SCHEDULE_OFFSET_MINUTES } from "@/lib/multiplatform/types";
import { ACTIVE_SLOT_STATUSES } from "@/lib/schedule-slots";
import { getAppDateParts } from "@/lib/timezone";
import type { SocialPlatform } from "@/lib/types";

export type WarmupPostsByDay = {
  date: string;
  count: number;
  times: string[];
  expectedCount: number | null;
  matchesWarmup: boolean;
  warmupDayIndex: number | null;
  partialStartDay: boolean;
  expectedTimes: string[];
};

export type WarmupScheduleInspect = {
  warmupPlan: number[];
  warmupDayIndex: number | null;
  warmupExpectedByDay: Record<string, number>;
  warmupStartDate: string | null;
  postsByDay: WarmupPostsByDay[];
  anchorScheduledAt: string | null;
  calendarStartAt: string | null;
  partialFirstDay: boolean;
  warmupDays: number;
  timezone: string;
};

function timeLabelFromInstant(iso: string | Date) {
  const parts = getAppDateParts(new Date(iso));
  return `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;
}

function daysBetween(startKey: string, endKey: string) {
  const [sy, sm, sd] = startKey.split("-").map(Number);
  const [ey, em, ed] = endKey.split("-").map(Number);
  const startUtc = Date.UTC(sy, sm - 1, sd);
  const endUtc = Date.UTC(ey, em - 1, ed);
  return Math.round((endUtc - startUtc) / 86_400_000);
}

function applyPlatformOffset(date: Date, platform: SocialPlatform) {
  if (platform !== "tiktok") return date;
  return new Date(date.getTime() + TIKTOK_SCHEDULE_OFFSET_MINUTES * 60_000);
}

function groupPostsByDay(posts: Array<{ scheduled_at: string }>) {
  const groups = new Map<string, string[]>();

  for (const post of posts) {
    const key = warmupDateKey(new Date(post.scheduled_at));
    const list = groups.get(key) ?? [];
    list.push(post.scheduled_at);
    groups.set(key, list);
  }

  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, isos]) => ({
      date,
      times: isos
        .sort((a, b) => new Date(a).getTime() - new Date(b).getTime())
        .map((iso) => timeLabelFromInstant(iso)),
    }));
}

async function fetchFutureActivePosts(
  supabase: SupabaseClient,
  platform: SocialPlatform,
  accountId: string,
  now: Date,
) {
  let query = supabase
    .from("scheduled_posts")
    .select("id, scheduled_at")
    .in("status", [...ACTIVE_SLOT_STATUSES])
    .gte("scheduled_at", now.toISOString())
    .order("scheduled_at", { ascending: true });

  if (platform === "tiktok") {
    query = query.eq("platform", "tiktok").eq("tiktok_account_id", accountId);
  } else {
    query = query.or(`platform.is.null,platform.eq.instagram`).eq("account_id", accountId);
  }

  const { data, error } = await query;
  if (error) throw new Error(`Falha ao buscar posts para warmup inspect: ${error.message}`);
  return data ?? [];
}

export async function inspectWarmupSchedule(params: {
  supabase: SupabaseClient;
  platform: SocialPlatform;
  accountId: string;
  scheduleMode: string;
  gradeSource: string;
  warmupDays?: number;
  warmupDayOffset?: number;
  now?: Date;
}): Promise<WarmupScheduleInspect | null> {
  if (params.scheduleMode !== "warmup" && params.gradeSource !== "warmup") {
    return null;
  }

  const now = params.now ?? new Date();
  const posts = await fetchFutureActivePosts(
    params.supabase,
    params.platform,
    params.accountId,
    now,
  );

  const warmupDays = params.warmupDays ?? DEFAULT_WARMUP_DAYS;
  const warmupDayOffset = params.warmupDayOffset ?? 0;
  const warmupPlan = [...buildWarmupRamp(warmupDays)];

  if (!posts.length) {
    return {
      warmupPlan,
      warmupDayIndex: null,
      warmupExpectedByDay: {},
      warmupStartDate: null,
      postsByDay: [],
      anchorScheduledAt: null,
      calendarStartAt: null,
      partialFirstDay: false,
      warmupDays,
      timezone: "America/Sao_Paulo",
    };
  }

  const firstScheduledAt = new Date(posts[0].scheduled_at);
  const calendar = resolveWarmupCalendarStart({ firstScheduledAt, now });
  const warmupStartDate = calendar.warmupStartDate;
  const todayKey = warmupDateKey(now);
  const todayDayOffset = daysBetween(warmupStartDate, todayKey);
  const warmupDayIndex =
    todayDayOffset >= 0 ? todayDayOffset + warmupDayOffset : null;

  const actualByDay = groupPostsByDay(posts);

  const planSchedule = generateWarmupSchedule({
    count: posts.length,
    warmupDays,
    warmupDayOffset,
    firstScheduledAt,
    now,
  }).map((slot) => applyPlatformOffset(slot, params.platform));

  const planByDay = groupPostsByDay(
    planSchedule.map((scheduled_at) => ({ scheduled_at: scheduled_at.toISOString() })),
  );
  const planTimesByDate = new Map(planByDay.map((row) => [row.date, row.times]));

  const warmupExpectedByDay: Record<string, number> = {};
  for (const row of planByDay) {
    warmupExpectedByDay[row.date] = row.times.length;
  }

  const postsByDay: WarmupPostsByDay[] = actualByDay.map((row) => {
    const dayOffset = daysBetween(warmupStartDate, row.date);
    const absoluteDayIndex = dayOffset >= 0 ? dayOffset + warmupDayOffset : null;
    const expectedTimes = planTimesByDate.get(row.date) ?? [];

    const expectedCount = expectedTimes.length > 0 ? expectedTimes.length : null;
    const partialStartDay =
      calendar.partialFirstDay &&
      dayOffset === 0 &&
      (expectedCount ?? 0) < (warmupPlan[0] ?? 3);

    const matchesWarmup =
      expectedCount !== null &&
      row.times.length === expectedCount &&
      row.times.every((time, index) => time === expectedTimes[index]);

    return {
      date: row.date,
      count: row.times.length,
      times: row.times,
      expectedCount,
      matchesWarmup,
      warmupDayIndex: absoluteDayIndex,
      partialStartDay,
      expectedTimes,
    };
  });

  return {
    warmupPlan,
    warmupDayIndex,
    warmupExpectedByDay,
    warmupStartDate,
    postsByDay,
    anchorScheduledAt: firstScheduledAt.toISOString(),
    calendarStartAt: calendar.calendarStart.toISOString(),
    partialFirstDay: calendar.partialFirstDay,
    warmupDays,
    timezone: "America/Sao_Paulo",
  };
}
