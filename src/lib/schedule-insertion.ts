import {
  DEFAULT_WARMUP_DAYS,
  POST_WARMUP_POSTS_PER_DAY,
  WARMUP_RAMP_POSTS,
  buildWarmupRamp,
  generateWarmupScheduleSlice,
  groupWarmupScheduleByDay,
} from "@/lib/account-warmup";
import type { ContentType, SocialPlatform } from "@/lib/types";
import { APP_TIMEZONE, getAppDateParts } from "@/lib/timezone";
import {
  buildAutoTimeSlots,
  earliestScheduleInstant,
  ensureFutureScheduleSlot,
  generateBulkScheduleFromSlots,
  generateCustomSchedule,
  generateSmartScheduleToday,
  resolveAutoPostsPerDay,
  sanitizeScheduleDates,
  type AutoScheduleOptions,
  type CustomScheduleOptions,
  type ScheduleMode,
  type WarmupScheduleOptions,
} from "@/lib/smart-schedule";
import type { SupabaseClient } from "@supabase/supabase-js";

export type ScheduleInsertionStrategy = "continue" | "new_plan" | "fill_gaps";

export interface ExistingScheduledPostRef {
  id: string;
  scheduled_at: string;
  upload_batch_id?: string | null;
  status: string;
}

export interface ScheduleInsertionDayRow {
  planDay: number;
  dateLabel: string;
  existingCount: number;
  addingCount: number;
  dailyLimit: number;
  times: string[];
  status: "filled" | "adding" | "partial";
}

export interface ScheduleInsertionPreview {
  strategy: ScheduleInsertionStrategy;
  continuing: boolean;
  planSlotOffset: number;
  warnings: string[];
  days: ScheduleInsertionDayRow[];
  summaryLabel: string;
}

export interface ResolveScheduleInsertionParams {
  supabase: SupabaseClient;
  platform: SocialPlatform;
  accountId: string;
  contentType: ContentType;
  mode: ScheduleMode;
  strategy: ScheduleInsertionStrategy;
  newVideoCount: number;
  uploadBatchId?: string | null;
  /** Fallback quando posts antigos não têm upload_batch_id gravado. */
  clientBatchScheduledCount?: number;
  warmup?: WarmupScheduleOptions;
  auto?: AutoScheduleOptions;
  custom?: CustomScheduleOptions;
  now?: Date;
}

export interface ScheduleInsertionResult {
  schedule: Date[];
  preview: ScheduleInsertionPreview;
}

const ACTIVE_STATUSES = ["pending", "processing", "retrying"];

function logInsertion(event: string, detail: Record<string, unknown>) {
  if (typeof console !== "undefined") {
    console.info(`[schedule-insert] ${event}`, detail);
  }
}

function dateKey(iso: string) {
  const parts = getAppDateParts(new Date(iso));
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function formatDateLabel(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", {
    timeZone: APP_TIMEZONE,
    day: "2-digit",
    month: "2-digit",
  });
}

function formatTime(iso: string) {
  const parts = getAppDateParts(new Date(iso));
  return `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;
}

export async function fetchPendingPostsForAccount(
  supabase: SupabaseClient,
  platform: SocialPlatform,
  accountId: string,
  contentType?: ContentType,
) {
  let query = supabase
    .from("scheduled_posts")
    .select("id, scheduled_at, upload_batch_id, status, content_type")
    .in("status", ACTIVE_STATUSES)
    .order("scheduled_at", { ascending: true });

  if (platform === "tiktok") {
    query = query.eq("platform", "tiktok").eq("tiktok_account_id", accountId);
  } else {
    query = query.eq("platform", "instagram").eq("account_id", accountId);
  }

  if (contentType) {
    query = query.eq("content_type", contentType);
  }

  const { data, error } = await query;
  if (error) {
    logInsertion("fetch_error", { platform, accountId, error: error.message });
    throw new Error(`Falha ao carregar calendário: ${error.message}`);
  }

  return (data ?? []) as ExistingScheduledPostRef[];
}

export function countBatchScheduledPosts(
  existing: ExistingScheduledPostRef[],
  uploadBatchId?: string | null,
) {
  if (!uploadBatchId) return 0;
  return existing.filter((post) => post.upload_batch_id === uploadBatchId).length;
}

export function resolveDefaultInsertionStrategy(params: {
  uploadBatchId?: string | null;
  batchScheduledCount: number;
  accountPendingCount: number;
  mode: ScheduleMode;
}): ScheduleInsertionStrategy {
  if (params.batchScheduledCount > 0) {
    return "continue";
  }
  if (params.accountPendingCount > 0) {
    return "continue";
  }
  return "new_plan";
}

export function shouldShowInsertionStrategyPicker(params: {
  batchScheduledCount: number;
  accountPendingCount: number;
}) {
  if (params.batchScheduledCount > 0) return false;
  return params.accountPendingCount > 0;
}

function resolveAnchorStartDate(existing: ExistingScheduledPostRef[], batchId?: string | null) {
  const batchPosts = batchId
    ? existing.filter((p) => p.upload_batch_id === batchId)
    : existing;
  const source = batchPosts.length ? batchPosts : existing;
  if (!source.length) return undefined;
  return new Date(source[0].scheduled_at);
}

function computePlanContext(params: {
  strategy: ScheduleInsertionStrategy;
  mode: ScheduleMode;
  existing: ExistingScheduledPostRef[];
  uploadBatchId?: string | null;
  clientBatchScheduledCount?: number;
  auto?: AutoScheduleOptions;
}) {
  const batchScheduled = Math.max(
    countBatchScheduledPosts(params.existing, params.uploadBatchId),
    params.clientBatchScheduledCount ?? 0,
  );
  const accountPending = params.existing.length;

  if (params.strategy === "new_plan") {
    return { planSlotOffset: 0, anchorStartDate: undefined as Date | undefined, continuing: false };
  }

  if (params.strategy === "continue") {
    const planSlotOffset =
      batchScheduled > 0
        ? batchScheduled
        : accountPending;
    const anchorStartDate = resolveAnchorStartDate(params.existing, params.uploadBatchId);
    return {
      planSlotOffset,
      anchorStartDate,
      continuing: planSlotOffset > 0,
    };
  }

  return { planSlotOffset: 0, anchorStartDate: undefined as Date | undefined, continuing: false };
}

function planDayNumberFromSlotOffset(offset: number) {
  const ramp = buildWarmupRamp(DEFAULT_WARMUP_DAYS);
  let remaining = offset;
  let dayIndex = 0;
  while (dayIndex < ramp.length && remaining >= ramp[dayIndex]) {
    remaining -= ramp[dayIndex];
    dayIndex++;
  }
  if (dayIndex < ramp.length) return dayIndex + 1;
  return ramp.length + Math.floor(remaining / POST_WARMUP_POSTS_PER_DAY) + 1;
}

function buildAutoContinuationSchedule(params: {
  count: number;
  planSlotOffset: number;
  anchorStartDate?: Date;
  auto?: AutoScheduleOptions;
  now: Date;
}) {
  const profile = params.auto?.profile ?? "growing";
  const total = params.planSlotOffset + params.count;
  const postsPerDay = resolveAutoPostsPerDay(total, profile);
  const timeSlots = buildAutoTimeSlots(postsPerDay);
  const startDate = params.anchorStartDate ?? earliestScheduleInstant(params.now);
  const full = generateBulkScheduleFromSlots({
    count: total,
    startDate,
    postsPerDay,
    timeSlots,
    now: params.now,
  });
  return sanitizeScheduleDates(full, params.now).slice(params.planSlotOffset);
}

function buildWarmupOrAutoNewSchedule(params: {
  count: number;
  planSlotOffset: number;
  anchorStartDate?: Date;
  warmup?: WarmupScheduleOptions;
  auto?: AutoScheduleOptions;
  mode: ScheduleMode;
  now: Date;
}) {
  const useWarmup =
    params.mode === "warmup" || (params.mode === "auto" && params.auto?.profile === "new");

  if (useWarmup) {
    return generateWarmupScheduleSlice({
      count: params.count,
      planSlotOffset: params.planSlotOffset,
      warmupDays: params.warmup?.warmupDays ?? DEFAULT_WARMUP_DAYS,
      warmupDayOffset: params.warmup?.warmupDayOffset ?? 0,
      startDate: params.anchorStartDate,
      now: params.now,
    });
  }

  return buildAutoContinuationSchedule({
    count: params.count,
    planSlotOffset: params.planSlotOffset,
    anchorStartDate: params.anchorStartDate,
    auto: params.auto,
    now: params.now,
  });
}

function buildCustomContinuationSchedule(params: {
  count: number;
  planSlotOffset: number;
  custom: CustomScheduleOptions;
  existing: ExistingScheduledPostRef[];
  strategy: ScheduleInsertionStrategy;
  continuing: boolean;
  now: Date;
}) {
  const { postsPerDay, timeSlots } = params.custom;
  if (params.strategy === "fill_gaps" || (params.continuing && params.existing.length > 0)) {
    return buildFillGapsSchedule({
      count: params.count,
      timeSlots,
      postsPerDay,
      existing: params.existing,
      now: params.now,
    });
  }

  const totalVideos = params.planSlotOffset + params.count;
  const { schedule: full } = generateCustomSchedule(totalVideos, params.custom, params.now);
  const sliced = full.slice(params.planSlotOffset);
  return applySlotsAgainstCalendar({
    schedule: sliced,
    existing: params.existing,
    postsPerDay,
    timeSlots,
    now: params.now,
  }).schedule;
}

function buildFillGapsSchedule(params: {
  count: number;
  timeSlots: Array<{ hour: number; minute: number }>;
  postsPerDay: number;
  existing: ExistingScheduledPostRef[];
  now: Date;
}) {
  const schedule: Date[] = [];
  const occupancy = new Map<string, number>();
  const occupiedTimes = new Set<string>();

  for (const post of params.existing) {
    const key = dateKey(post.scheduled_at);
    occupancy.set(key, (occupancy.get(key) ?? 0) + 1);
    occupiedTimes.add(`${key}T${formatTime(post.scheduled_at)}`);
  }

  let dayOffset = 0;
  let slotIndex = 0;

  while (schedule.length < params.count) {
    if (dayOffset > 400) break;

    const base = params.now;
    const parts = getAppDateParts(base);
    const candidateDay = new Date(
      Date.UTC(parts.year, parts.month - 1, parts.day + dayOffset),
    );

    const dayCount = occupancy.get(dateKey(candidateDay.toISOString())) ?? 0;
    if (dayCount >= params.postsPerDay) {
      dayOffset++;
      slotIndex = 0;
      continue;
    }

    const slot = params.timeSlots[slotIndex % params.timeSlots.length];
    let candidate = ensureFutureScheduleSlot(
      new Date(
        candidateDay.getTime() +
          slot.hour * 3_600_000 +
          slot.minute * 60_000,
      ),
      params.now,
    );

    const key = dateKey(candidate.toISOString());
    const timeKey = `${key}T${formatTime(candidate.toISOString())}`;

    if (occupiedTimes.has(timeKey) || (occupancy.get(key) ?? 0) >= params.postsPerDay) {
      slotIndex++;
      if (slotIndex % params.timeSlots.length === 0) dayOffset++;
      continue;
    }

    schedule.push(candidate);
    occupiedTimes.add(timeKey);
    occupancy.set(key, (occupancy.get(key) ?? 0) + 1);
    slotIndex++;
  }

  return schedule;
}

function buildTodayContinuation(params: {
  count: number;
  existing: ExistingScheduledPostRef[];
  now: Date;
}) {
  const todayKey = dateKey(params.now.toISOString());
  const existingToday = params.existing.filter((p) => dateKey(p.scheduled_at) === todayKey).length;
  const maxToday = generateSmartScheduleToday(500, params.now).length;
  const schedule: Date[] = [];

  const todayCapacity = Math.max(0, maxToday - existingToday);
  if (todayCapacity > 0) {
    const todaySlots = generateSmartScheduleToday(
      Math.min(params.count, todayCapacity) + existingToday,
      params.now,
    ).slice(existingToday);
    schedule.push(...todaySlots);
  }

  if (schedule.length < params.count) {
    const virtualExisting: ExistingScheduledPostRef[] = [
      ...params.existing,
      ...schedule.map((slot, index) => ({
        id: `today-new-${index}`,
        scheduled_at: slot.toISOString(),
        status: "pending",
      })),
    ];
    const overflow = buildFillGapsSchedule({
      count: params.count - schedule.length,
      timeSlots: buildAutoTimeSlots(Math.min(params.count, 10)),
      postsPerDay: 10,
      existing: virtualExisting,
      now: params.now,
    });
    schedule.push(...overflow);
  }

  return sanitizeScheduleDates(schedule, params.now);
}

function applySlotsAgainstCalendar(params: {
  schedule: Date[];
  existing: ExistingScheduledPostRef[];
  postsPerDay: number;
  timeSlots: Array<{ hour: number; minute: number }>;
  now: Date;
}) {
  const occupancy = new Map<string, number>();
  const occupiedTimes = new Set<string>();

  for (const post of params.existing) {
    const key = dateKey(post.scheduled_at);
    occupancy.set(key, (occupancy.get(key) ?? 0) + 1);
    occupiedTimes.add(`${key}T${formatTime(post.scheduled_at)}`);
  }

  const result: Date[] = [];

  for (const rawSlot of params.schedule) {
    let candidate = ensureFutureScheduleSlot(rawSlot, params.now);
    const originalLabel = `${formatDateLabel(candidate.toISOString())} ${formatTime(candidate.toISOString())}`;
    let slotIndex = 0;
    let dayOffset = 0;

    for (let attempt = 0; attempt < 500; attempt++) {
      const parts = getAppDateParts(params.now);
      const candidateDay = new Date(
        Date.UTC(parts.year, parts.month - 1, parts.day + dayOffset),
      );
      const slot = params.timeSlots[slotIndex % params.timeSlots.length];
      candidate = ensureFutureScheduleSlot(
        new Date(
          candidateDay.getTime() + slot.hour * 3_600_000 + slot.minute * 60_000,
        ),
        params.now,
      );

      const key = dateKey(candidate.toISOString());
      const timeKey = `${key}T${formatTime(candidate.toISOString())}`;
      const dayCount = occupancy.get(key) ?? 0;

      if (dayCount >= params.postsPerDay || occupiedTimes.has(timeKey)) {
        slotIndex++;
        if (slotIndex % params.timeSlots.length === 0) dayOffset++;
        continue;
      }
      break;
    }

    const movedLabel = `${formatDateLabel(candidate.toISOString())} ${formatTime(candidate.toISOString())}`;
    if (movedLabel !== originalLabel) {
      logInsertion("schedule-conflict", { from: originalLabel, to: movedLabel });
    }

    result.push(candidate);
    const key = dateKey(candidate.toISOString());
    occupiedTimes.add(`${key}T${formatTime(candidate.toISOString())}`);
    occupancy.set(key, (occupancy.get(key) ?? 0) + 1);
    slotIndex++;
  }

  return { schedule: result, warnings: [] as string[] };
}

function dailyLimitForMode(
  planDayIndex: number,
  mode: ScheduleMode,
  auto?: AutoScheduleOptions,
  custom?: CustomScheduleOptions,
) {
  if (mode === "custom") {
    return custom?.postsPerDay ?? 15;
  }
  if (mode === "today") {
    return generateSmartScheduleToday(500, new Date()).length;
  }
  if (mode === "warmup" || (mode === "auto" && auto?.profile === "new")) {
    return warmupDailyLimit(planDayIndex);
  }
  return resolveAutoPostsPerDay(100, auto?.profile ?? "growing");
}

function buildPriorFilledPlanDays(params: {
  existing: ExistingScheduledPostRef[];
  firstPlanDay: number;
  mode: ScheduleMode;
  auto?: AutoScheduleOptions;
  continuing: boolean;
}): ScheduleInsertionDayRow[] {
  if (!params.continuing || params.firstPlanDay <= 1) return [];

  const byDate = new Map<string, { count: number; label: string; iso: string }>();
  for (const post of params.existing) {
    const key = dateKey(post.scheduled_at);
    const prev = byDate.get(key);
    if (!prev) {
      byDate.set(key, {
        count: 1,
        label: formatDateLabel(post.scheduled_at),
        iso: post.scheduled_at,
      });
    } else {
      prev.count++;
    }
  }

  const sorted = [...byDate.values()].sort((a, b) => a.iso.localeCompare(b.iso));
  const rows: ScheduleInsertionDayRow[] = [];

  for (let i = 0; i < sorted.length && i + 1 < params.firstPlanDay; i++) {
    const planDay = i + 1;
    const entry = sorted[i];
    const limit = dailyLimitForMode(planDay - 1, params.mode, params.auto, undefined);
    rows.push({
      planDay,
      dateLabel: entry.label,
      existingCount: entry.count,
      addingCount: 0,
      dailyLimit: limit,
      times: [],
      status: entry.count >= limit ? "filled" : "partial",
    });
  }

  return rows;
}

function buildInsertionDayPreview(params: {
  schedule: Date[];
  existing: ExistingScheduledPostRef[];
  mode: ScheduleMode;
  auto?: AutoScheduleOptions;
  custom?: CustomScheduleOptions;
  planSlotOffset: number;
  continuing: boolean;
  strategy: ScheduleInsertionStrategy;
  extraWarnings?: string[];
}): ScheduleInsertionPreview {
  const warnings: string[] = [...(params.extraWarnings ?? [])];
  const existingByDate = new Map<string, number>();
  for (const post of params.existing) {
    const key = dateKey(post.scheduled_at);
    existingByDate.set(key, (existingByDate.get(key) ?? 0) + 1);
  }

  const addingByDate = new Map<string, { times: string[]; count: number }>();
  for (const slot of params.schedule) {
    const key = dateKey(slot.toISOString());
    const entry = addingByDate.get(key) ?? { times: [], count: 0 };
    entry.times.push(formatTime(slot.toISOString()));
    entry.count++;
    addingByDate.set(key, entry);
  }

  const breakdown = groupWarmupScheduleByDay(params.schedule);
  const firstPlanDay = planDayNumberFromSlotOffset(params.planSlotOffset);

  const priorDays = buildPriorFilledPlanDays({
    existing: params.existing,
    firstPlanDay,
    mode: params.mode,
    auto: params.auto,
    continuing: params.continuing,
  });

  const addingDays: ScheduleInsertionDayRow[] = breakdown.map((day, index) => {
    const planDay = firstPlanDay + index;
    const limit = dailyLimitForMode(planDay - 1, params.mode, params.auto, params.custom);

    const sampleSlot = params.schedule.find(
      (slot) => formatDateLabel(slot.toISOString()) === day.dateLabel,
    );
    const dateKeyForDay = sampleSlot ? dateKey(sampleSlot.toISOString()) : "";
    const existingOnDate = dateKeyForDay ? (existingByDate.get(dateKeyForDay) ?? 0) : 0;
    const adding = day.posts;
    const totalOnDay = existingOnDate + adding;

    if (totalOnDay > limit) {
      warnings.push(
        `Dia ${day.dateLabel}: ${totalOnDay} posts (limite ${limit}). Verifique o calendário.`,
      );
    }

    let status: ScheduleInsertionDayRow["status"] = "adding";
    if (existingOnDate >= limit && adding === 0) status = "filled";
    else if (existingOnDate > 0 && adding > 0) status = "partial";

    return {
      planDay,
      dateLabel: day.dateLabel,
      existingCount: existingOnDate,
      addingCount: adding,
      dailyLimit: limit,
      times: day.times,
      status,
    };
  });

  const days = [...priorDays, ...addingDays];

  if (params.continuing) {
    warnings.unshift(
      "Este agendamento continua a sequência do plano atual, em vez de reiniciar no Dia 1.",
    );
  }

  const strategyLabels: Record<ScheduleInsertionStrategy, string> = {
    continue: "Continuando cronograma",
    new_plan: "Novo cronograma",
    fill_gaps: "Preenchendo horários livres",
  };

  return {
    strategy: params.strategy,
    continuing: params.continuing,
    planSlotOffset: params.planSlotOffset,
    warnings,
    days,
    summaryLabel: strategyLabels[params.strategy],
  };
}

export async function resolveScheduleInsertionPlan(
  params: ResolveScheduleInsertionParams,
): Promise<ScheduleInsertionResult> {
  const now = params.now ?? new Date();
  const existing = await fetchPendingPostsForAccount(
    params.supabase,
    params.platform,
    params.accountId,
    params.contentType,
  );

  const batchScheduled = Math.max(
    countBatchScheduledPosts(existing, params.uploadBatchId),
    params.clientBatchScheduledCount ?? 0,
  );
  const { planSlotOffset, anchorStartDate, continuing } = computePlanContext({
    strategy: params.strategy,
    mode: params.mode,
    existing,
    uploadBatchId: params.uploadBatchId,
    clientBatchScheduledCount: params.clientBatchScheduledCount,
    auto: params.auto,
  });

  logInsertion("plan_start", {
    platform: params.platform,
    accountId: params.accountId,
    mode: params.mode,
    strategy: params.strategy,
    newVideoCount: params.newVideoCount,
    uploadBatchId: params.uploadBatchId,
    batchScheduled,
    accountPending: existing.length,
    planSlotOffset,
    continuing,
  });

  let schedule: Date[] = [];
  const extraWarnings: string[] = [];

  if (params.mode === "today") {
    schedule = buildTodayContinuation({
      count: params.newVideoCount,
      existing,
      now,
    });
    if (existing.filter((p) => dateKey(p.scheduled_at) === dateKey(now.toISOString())).length > 0) {
      extraWarnings.push(
        "Alguns horários de hoje já estavam ocupados. Os excedentes foram movidos para os próximos dias.",
      );
    }
  } else if (params.mode === "custom" && params.custom) {
    schedule = buildCustomContinuationSchedule({
      count: params.newVideoCount,
      planSlotOffset,
      custom: params.custom,
      existing,
      strategy: params.strategy,
      continuing: continuing && params.strategy !== "new_plan",
      now,
    });
  } else if (params.mode === "warmup" || params.mode === "auto") {
    const useAutoFillGaps =
      params.mode === "auto" &&
      params.strategy !== "new_plan" &&
      batchScheduled === 0 &&
      existing.length > 0 &&
      params.auto?.profile !== "new";

    if (useAutoFillGaps) {
      const postsPerDay = resolveAutoPostsPerDay(
        params.newVideoCount,
        params.auto?.profile ?? "growing",
      );
      schedule = buildFillGapsSchedule({
        count: params.newVideoCount,
        timeSlots: buildAutoTimeSlots(postsPerDay),
        postsPerDay,
        existing,
        now,
      });
    } else {
      schedule = buildWarmupOrAutoNewSchedule({
        count: params.newVideoCount,
        planSlotOffset: params.strategy === "new_plan" ? 0 : planSlotOffset,
        anchorStartDate: params.strategy === "new_plan" ? undefined : anchorStartDate,
        warmup: params.warmup,
        auto: params.auto,
        mode: params.mode,
        now,
      });
    }
  } else {
    schedule = buildWarmupOrAutoNewSchedule({
      count: params.newVideoCount,
      planSlotOffset: 0,
      auto: params.auto,
      mode: "auto",
      now,
    });
  }

  schedule = sanitizeScheduleDates(schedule, now);

  const preview = buildInsertionDayPreview({
    schedule,
    existing,
    mode: params.mode,
    auto: params.auto,
    custom: params.custom,
    planSlotOffset: params.strategy === "new_plan" ? 0 : planSlotOffset,
    continuing: params.strategy !== "new_plan" && continuing,
    strategy: params.strategy,
    extraWarnings,
  });

  logInsertion("plan_ready", {
    slots: schedule.length,
    first: schedule[0]?.toISOString(),
    last: schedule[schedule.length - 1]?.toISOString(),
    warnings: preview.warnings.length,
  });

  return { schedule, preview };
}

export interface BuildScheduleWithInsertionParams extends Omit<
  ResolveScheduleInsertionParams,
  "newVideoCount" | "strategy"
> {
  count: number;
  batchOffset?: number;
  totalCount?: number;
  strategy?: ScheduleInsertionStrategy;
}

/** Camada central usada por todos os modos antes de preview/confirm. */
export async function buildScheduleWithInsertion(
  params: BuildScheduleWithInsertionParams,
) {
  const totalCount = params.totalCount ?? params.count;
  const batchOffset = params.batchOffset ?? 0;
  const existing = await fetchPendingPostsForAccount(
    params.supabase,
    params.platform,
    params.accountId,
    params.contentType,
  );
  const batchScheduled = Math.max(
    countBatchScheduledPosts(existing, params.uploadBatchId),
    params.clientBatchScheduledCount ?? 0,
  );
  const strategy =
    params.strategy ??
    resolveDefaultInsertionStrategy({
      uploadBatchId: params.uploadBatchId,
      batchScheduledCount: batchScheduled,
      accountPendingCount: existing.length,
      mode: params.mode,
    });

  const result = await resolveScheduleInsertionPlan({
    ...params,
    strategy,
    newVideoCount: totalCount,
  });

  const schedule = result.schedule.slice(batchOffset, batchOffset + params.count);
  return {
    ...result,
    schedule,
    strategy,
    totalSchedule: result.schedule,
  };
}

export async function resolveRescheduleSlot(params: {
  supabase: SupabaseClient;
  platform: SocialPlatform;
  accountId: string;
  contentType: ContentType;
  requestedAt: string;
  excludePostId?: string;
  now?: Date;
}) {
  const now = params.now ?? new Date();
  const existing = await fetchPendingPostsForAccount(
    params.supabase,
    params.platform,
    params.accountId,
    params.contentType,
  ).then((posts) => posts.filter((post) => post.id !== params.excludePostId));

  const postsPerDay = 15;
  const timeSlots = buildAutoTimeSlots(10);
  const requested = ensureFutureScheduleSlot(new Date(params.requestedAt), now);
  const { schedule } = applySlotsAgainstCalendar({
    schedule: [requested],
    existing,
    postsPerDay,
    timeSlots,
    now,
  });

  const resolved = schedule[0] ?? requested;
  const moved = resolved.getTime() !== requested.getTime();
  logInsertion("schedule-reschedule", {
    platform: params.platform,
    accountId: params.accountId,
    requested: requested.toISOString(),
    resolved: resolved.toISOString(),
    moved,
  });

  return {
    scheduled_at: resolved.toISOString(),
    moved,
    warning: moved
      ? "O horário escolhido conflitava com o calendário e foi ajustado automaticamente."
      : undefined,
  };
}

export const SCHEDULE_STRATEGY_LABELS: Record<
  ScheduleInsertionStrategy,
  { title: string; description: string }
> = {
  continue: {
    title: "Continuar cronograma atual",
    description:
      "Adiciona os vídeos depois dos posts já agendados, mantendo a sequência do plano atual.",
  },
  new_plan: {
    title: "Criar novo cronograma",
    description: "Cria uma nova distribuição a partir de hoje, ignorando a programação anterior.",
  },
  fill_gaps: {
    title: "Preencher próximos horários livres",
    description:
      "Encaixa os vídeos nos próximos espaços disponíveis sem ultrapassar o limite diário.",
  },
};

/** Limite diário do modo aquecimento por índice de dia de plano (0-based). */
export function warmupDailyLimit(planDayIndex: number) {
  const ramp = [...WARMUP_RAMP_POSTS];
  if (planDayIndex < ramp.length) return ramp[planDayIndex];
  return POST_WARMUP_POSTS_PER_DAY;
}
