import {
  DEFAULT_WARMUP_DAYS,
  describeWarmupPlan,
  estimateWarmupDuration,
  generateWarmupSchedule,
  groupWarmupScheduleByDay,
  type AutoAccountProfile,
} from "@/lib/account-warmup";
import {
  APP_TIMEZONE,
  atHourInAppTz,
  atHourOnDayOffsetInAppTz,
  endOfPostingDayInAppTz,
  getAppDateParts,
} from "@/lib/timezone";

const PEAK_HOURS_BR = [7, 9, 11, 12, 14, 16, 18, 19, 20, 21];
const MIN_GAP_MINUTES = 25;
const BUFFER_MINUTES = 15;

export { BUFFER_MINUTES as SCHEDULE_BUFFER_MINUTES };

/** Primeiro instante permitido para agendamento (agora + buffer de segurança). */
export function earliestScheduleInstant(now = new Date()): Date {
  return new Date(now.getTime() + BUFFER_MINUTES * 60_000);
}

/**
 * Garante horário de parede (APP_TIMEZONE) em dia futuro válido.
 * Se o slot já passou hoje, avança para o próximo dia com o mesmo horário.
 */
export function rollSlotToFuture(
  base: Date,
  dayOffset: number,
  hour: number,
  minute: number,
  now = new Date(),
): Date {
  const earliest = earliestScheduleInstant(now);
  let offset = dayOffset;

  for (let attempt = 0; attempt < 366; attempt++) {
    const candidate = atHourOnDayOffsetInAppTz(base, offset, hour, minute);
    if (candidate > earliest) return candidate;
    offset++;
  }

  throw new Error("Não foi possível encontrar horário futuro para agendamento.");
}

/** Move um instante agendado para o futuro, preservando hora/minuto em São Paulo. */
export function ensureFutureScheduleSlot(date: Date, now = new Date()): Date {
  const earliest = earliestScheduleInstant(now);
  if (date > earliest) return date;

  const parts = getAppDateParts(date);
  const nowParts = getAppDateParts(now);
  const dayDiff = Math.floor(
    (Date.UTC(parts.year, parts.month - 1, parts.day) -
      Date.UTC(nowParts.year, nowParts.month - 1, nowParts.day)) /
      86_400_000,
  );

  return rollSlotToFuture(now, Math.max(0, dayDiff), parts.hour, parts.minute, now);
}

export function sanitizeScheduleDates(schedule: Date[], now = new Date()): Date[] {
  return schedule.map((slot) => ensureFutureScheduleSlot(slot, now));
}

export function sanitizeScheduledAt(value: string | Date, now = new Date()): string {
  return ensureFutureScheduleSlot(new Date(value), now).toISOString();
}

const HOURS_BY_POSTS_PER_DAY: Record<number, number[]> = {
  1: [18],
  2: [12, 19],
  3: [9, 14, 20],
};

export type ScheduleMode = "today" | "auto" | "warmup" | "custom";

export const DEFAULT_CUSTOM_START_TIME = "07:00";
export const DEFAULT_CUSTOM_END_TIME = "22:00";
export const DEFAULT_CUSTOM_POSTS_PER_DAY = 15;

export interface CustomScheduleOptions {
  postsPerDay: number;
  timeSlots: Array<{ hour: number; minute: number }>;
  startTime?: string;
  endTime?: string;
}

export function formatTimeSlot(hour: number, minute: number) {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function buildEvenTimeSlotsBetween(
  start: { hour: number; minute: number },
  end: { hour: number; minute: number },
  count: number,
) {
  if (count <= 0) return [] as Array<{ hour: number; minute: number }>;

  const startMinutes = start.hour * 60 + start.minute;
  const endMinutes = end.hour * 60 + end.minute;

  if (count === 1) {
    return [{ hour: start.hour, minute: start.minute }];
  }

  const step = (endMinutes - startMinutes) / (count - 1);
  const slots: Array<{ hour: number; minute: number }> = [];

  for (let index = 0; index < count; index++) {
    const total = Math.round(startMinutes + step * index);
    slots.push({
      hour: Math.floor(total / 60),
      minute: total % 60,
    });
  }

  return slots;
}

export function buildEvenTimeSlotStrings(startTime: string, endTime: string, count: number) {
  const start = parseTimeSlot(startTime);
  const end = parseTimeSlot(endTime);
  if (!start || !end || count < 1) return [] as string[];

  return buildEvenTimeSlotsBetween(start, end, count).map((slot) =>
    formatTimeSlot(slot.hour, slot.minute),
  );
}

/** Garante 1 horário único por post/dia, distribuído entre início e fim. */
export function resolveCustomScheduleOptions(options: CustomScheduleOptions): CustomScheduleOptions {
  const { postsPerDay, timeSlots: providedSlots, startTime, endTime } = options;

  if (providedSlots.length >= postsPerDay) {
    return {
      postsPerDay,
      timeSlots: providedSlots.slice(0, postsPerDay),
      startTime,
      endTime,
    };
  }

  const start =
    (startTime ? parseTimeSlot(startTime) : null) ??
    providedSlots[0] ??
    parseTimeSlot(DEFAULT_CUSTOM_START_TIME);
  const end =
    (endTime ? parseTimeSlot(endTime) : null) ??
    providedSlots[providedSlots.length - 1] ??
    parseTimeSlot(DEFAULT_CUSTOM_END_TIME);

  if (!start || !end) {
    if (providedSlots.length >= postsPerDay) {
      return {
        postsPerDay,
        timeSlots: providedSlots.slice(0, postsPerDay),
        startTime,
        endTime,
      };
    }

    const fallbackStart = providedSlots[0] ?? parseTimeSlot(DEFAULT_CUSTOM_START_TIME);
    const fallbackEnd =
      providedSlots[providedSlots.length - 1] ?? parseTimeSlot(DEFAULT_CUSTOM_END_TIME);
    if (!fallbackStart || !fallbackEnd) {
      return { postsPerDay, timeSlots: providedSlots, startTime, endTime };
    }

    return {
      postsPerDay,
      timeSlots: buildEvenTimeSlotsBetween(fallbackStart, fallbackEnd, postsPerDay),
      startTime: startTime ?? formatTimeSlot(fallbackStart.hour, fallbackStart.minute),
      endTime: endTime ?? formatTimeSlot(fallbackEnd.hour, fallbackEnd.minute),
    };
  }

  return {
    postsPerDay,
    timeSlots: buildEvenTimeSlotsBetween(start, end, postsPerDay),
    startTime: startTime ?? formatTimeSlot(start.hour, start.minute),
    endTime: endTime ?? formatTimeSlot(end.hour, end.minute),
  };
}

export function parseCustomSchedulePayload(payload: {
  posts_per_day: number;
  time_slots?: string[];
  start_time?: string;
  end_time?: string;
}): CustomScheduleOptions {
  const parsedSlots = parseTimeSlots(payload.time_slots ?? []);
  return resolveCustomScheduleOptions({
    postsPerDay: payload.posts_per_day,
    timeSlots: parsedSlots,
    startTime: payload.start_time ?? DEFAULT_CUSTOM_START_TIME,
    endTime: payload.end_time ?? DEFAULT_CUSTOM_END_TIME,
  });
}

export interface WarmupScheduleOptions {
  warmupDays?: number;
  warmupDayOffset?: number;
}

export interface AutoScheduleOptions {
  profile?: AutoAccountProfile;
  warmup?: WarmupScheduleOptions;
}

export function buildAutoTimeSlots(postsPerDay: number) {
  if (postsPerDay <= 0) return [] as Array<{ hour: number; minute: number }>;
  if (postsPerDay <= 3) {
    const hours = HOURS_BY_POSTS_PER_DAY[postsPerDay] ?? HOURS_BY_POSTS_PER_DAY[2];
    return hours.map((hour) => ({ hour, minute: 0 }));
  }

  const morningCount = Math.ceil(postsPerDay / 3);
  const afternoonCount = Math.ceil((postsPerDay - morningCount) / 2);
  const eveningCount = Math.max(1, postsPerDay - morningCount - afternoonCount);

  const morning = buildEvenTimeSlotsBetween({ hour: 7, minute: 0 }, { hour: 11, minute: 0 }, morningCount);
  const afternoon = buildEvenTimeSlotsBetween(
    { hour: 12, minute: 0 },
    { hour: 17, minute: 0 },
    afternoonCount,
  );
  const evening = buildEvenTimeSlotsBetween(
    { hour: 18, minute: 0 },
    { hour: 23, minute: 0 },
    eveningCount,
  );

  return [...morning, ...afternoon, ...evening].slice(0, postsPerDay);
}

export function resolveAutoPostsPerDay(videoCount: number, profile: AutoAccountProfile = "growing") {
  if (profile === "new") {
    return 7;
  }
  if (profile === "growing") {
    if (videoCount <= 14) return 7;
    if (videoCount <= 40) return 8;
    if (videoCount <= 80) return 9;
    return 10;
  }
  if (videoCount <= 20) return 10;
  if (videoCount <= 50) return 12;
  if (videoCount <= 100) return 14;
  return 15;
}

function atHour(base: Date, hour: number, minute = 0) {
  return atHourInAppTz(base, hour, minute);
}

function endOfPostingDay(base: Date) {
  return endOfPostingDayInAppTz(base);
}

export function parseTimeSlot(value: string): { hour: number; minute: number } | null {
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;

  const hour = parseInt(match[1], 10);
  const minute = parseInt(match[2], 10);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;

  return { hour, minute };
}

export function parseTimeSlots(values: string[]) {
  const parsed = values
    .map(parseTimeSlot)
    .filter((slot): slot is { hour: number; minute: number } => Boolean(slot));

  parsed.sort((a, b) => a.hour * 60 + a.minute - (b.hour * 60 + b.minute));
  return parsed;
}

export function generateCustomSchedule(
  count: number,
  options: CustomScheduleOptions,
  now = new Date(),
) {
  const { postsPerDay, timeSlots } = resolveCustomScheduleOptions(options);
  if (count <= 0 || !timeSlots.length || postsPerDay < 1) {
    return { schedule: [] as Date[], postsPerDay };
  }

  const schedule: Date[] = [];

  for (let index = 0; index < count; index++) {
    const dayIndex = Math.floor(index / postsPerDay);
    const slotInDay = index % postsPerDay;
    const slot = timeSlots[slotInDay];
    if (!slot) break;
    schedule.push(rollSlotToFuture(now, dayIndex, slot.hour, slot.minute, now));
  }

  return { schedule, postsPerDay };
}

export function countTodayAvailableSlots(now = new Date()) {
  return generateSmartScheduleToday(500, now).length;
}

export function generateSmartScheduleToday(count: number, now = new Date()): Date[] {
  if (count <= 0) return [];

  const earliest = new Date(now.getTime() + BUFFER_MINUTES * 60_000);
  const dayEnd = endOfPostingDay(now);
  const candidates: Date[] = [];

  for (const hour of PEAK_HOURS_BR) {
    const slot = atHour(now, hour);
    if (slot >= earliest && slot <= dayEnd) {
      candidates.push(slot);
    }
  }

  let filler = new Date(earliest);
  while (candidates.length < count * 3) {
    if (filler > dayEnd) break;
    candidates.push(new Date(filler));
    filler = new Date(filler.getTime() + MIN_GAP_MINUTES * 60_000);
  }

  candidates.sort((a, b) => a.getTime() - b.getTime());

  const uniqueCandidates = candidates.filter(
    (slot, index, arr) => index === 0 || slot.getTime() !== arr[index - 1].getTime(),
  );

  const schedule: Date[] = [];

  for (const slot of uniqueCandidates) {
    if (schedule.length >= count) break;

    const last = schedule[schedule.length - 1];
    if (!last || slot.getTime() - last.getTime() >= MIN_GAP_MINUTES * 60_000) {
      schedule.push(slot);
    }
  }

  let cursor = schedule[schedule.length - 1] ?? earliest;
  while (schedule.length < count) {
    cursor = new Date(cursor.getTime() + MIN_GAP_MINUTES * 60_000);
    if (cursor > dayEnd) break;
    schedule.push(cursor);
  }

  return schedule.slice(0, count);
}

export function generateSmartScheduleAuto(
  count: number,
  now = new Date(),
  auto?: AutoScheduleOptions,
) {
  const profile = auto?.profile ?? "growing";

  if (profile === "new") {
    const schedule = generateWarmupSchedule({
      count,
      warmupDays: auto?.warmup?.warmupDays ?? DEFAULT_WARMUP_DAYS,
      warmupDayOffset: auto?.warmup?.warmupDayOffset ?? 0,
      now,
    });
    return { schedule, postsPerDay: resolveAutoPostsPerDay(count, "new") };
  }

  const postsPerDay = resolveAutoPostsPerDay(count, profile);
  const timeSlots = buildAutoTimeSlots(postsPerDay);
  const earliest = earliestScheduleInstant(now);

  const firstSlotToday = timeSlots.length
    ? rollSlotToFuture(now, 0, timeSlots[0].hour, timeSlots[0].minute, now)
    : earliest;

  const startDate = firstSlotToday >= earliest ? now : atHourOnDayOffsetInAppTz(now, 1, 7, 0);
  const schedule = generateBulkScheduleFromSlots({
    count,
    startDate,
    postsPerDay,
    timeSlots,
    now,
  });

  return { schedule, postsPerDay };
}

export function generateBulkScheduleFromSlots(params: {
  count: number;
  startDate: Date;
  postsPerDay: number;
  timeSlots: Array<{ hour: number; minute: number }>;
  now?: Date;
}): Date[] {
  const { count, startDate, postsPerDay, timeSlots } = params;
  const now = params.now ?? new Date();
  if (!timeSlots.length) return [];

  const schedule: Date[] = [];
  let dayOffset = 0;
  let slotIndex = 0;

  for (let i = 0; i < count; i++) {
    const slot = timeSlots[slotIndex % timeSlots.length];
    schedule.push(rollSlotToFuture(startDate, dayOffset, slot.hour, slot.minute, now));

    slotIndex++;
    if (slotIndex % postsPerDay === 0) {
      dayOffset++;
      slotIndex = 0;
    }
  }

  return schedule;
}

export function generateBulkSchedule(params: {
  count: number;
  startDate: Date;
  postsPerDay: number;
  hours: number[];
  now?: Date;
}): Date[] {
  const { count, startDate, postsPerDay, hours } = params;
  const now = params.now ?? new Date();
  const schedule: Date[] = [];
  let dayOffset = 0;
  let slot = 0;

  for (let i = 0; i < count; i++) {
    const hour = hours[slot % hours.length];
    schedule.push(rollSlotToFuture(startDate, dayOffset, hour, 0, now));

    slot++;
    if (slot % postsPerDay === 0) {
      dayOffset++;
      slot = 0;
    }
  }

  return schedule;
}

export function buildSmartSchedule(
  mode: ScheduleMode,
  count: number,
  now = new Date(),
  warmup?: WarmupScheduleOptions,
  custom?: CustomScheduleOptions,
  auto?: AutoScheduleOptions,
) {
  if (mode === "warmup") {
    const schedule = sanitizeScheduleDates(
      generateWarmupSchedule({
        count,
        warmupDays: warmup?.warmupDays ?? DEFAULT_WARMUP_DAYS,
        warmupDayOffset: warmup?.warmupDayOffset ?? 0,
        now,
      }),
      now,
    );
    return {
      schedule,
      postsPerDay: 1,
      mode,
    };
  }

  if (mode === "today") {
    const schedule = sanitizeScheduleDates(generateSmartScheduleToday(count, now), now);
    return {
      schedule,
      postsPerDay: count,
      mode,
    };
  }

  if (mode === "custom") {
    if (!custom) {
      throw new Error("Configure posts por dia e horários no modo personalizado.");
    }
    const { schedule, postsPerDay } = generateCustomSchedule(count, custom, now);
    return { schedule: sanitizeScheduleDates(schedule, now), postsPerDay, mode };
  }

  const { schedule, postsPerDay } = generateSmartScheduleAuto(count, now, auto);
  return { schedule: sanitizeScheduleDates(schedule, now), postsPerDay, mode };
}

export interface ScheduleDurationEstimate {
  days: number;
  months: number;
  postsPerDay: number;
  label: string;
  shortLabel: string;
}

export function estimateScheduleDuration(
  count: number,
  mode: ScheduleMode = "auto",
  warmupDays = DEFAULT_WARMUP_DAYS,
  custom?: CustomScheduleOptions,
  auto?: AutoScheduleOptions,
): ScheduleDurationEstimate {
  if (count <= 0) {
    return { days: 0, months: 0, postsPerDay: 0, label: "", shortLabel: "" };
  }

  if (mode === "warmup") {
    const est = estimateWarmupDuration(count, warmupDays);
    return {
      days: est.days,
      months: est.months,
      postsPerDay: 0,
      label: est.label,
      shortLabel: est.shortLabel,
    };
  }

  if (mode === "today") {
    return {
      days: 1,
      months: 0,
      postsPerDay: count,
      label: `${count} vídeo(s) publicados hoje`,
      shortLabel: "hoje",
    };
  }

  if (mode === "custom") {
    const postsPerDay = custom?.postsPerDay ?? 1;
    const days = Math.ceil(count / postsPerDay);
    const months = Math.round((days / 30) * 10) / 10;
    return {
      days,
      months,
      postsPerDay,
      label: `${count} vídeo(s) em ~${days} dias (${postsPerDay} posts/dia)`,
      shortLabel: `~${days} dias`,
    };
  }

  if (mode === "auto" && auto?.profile === "new") {
    const est = estimateWarmupDuration(count, auto.warmup?.warmupDays ?? warmupDays);
    return {
      days: est.days,
      months: est.months,
      postsPerDay: 7,
      label: est.label,
      shortLabel: est.shortLabel,
    };
  }

  const postsPerDay = resolveAutoPostsPerDay(count, auto?.profile ?? "growing");
  const days = Math.ceil(count / postsPerDay);
  const months = Math.round((days / 30) * 10) / 10;

  let shortLabel: string;
  if (days < 30) {
    shortLabel = `~${days} dias`;
  } else if (months < 12) {
    shortLabel = `~${days} dias (~${Math.round(months)} meses)`;
  } else {
    const years = Math.floor(months / 12);
    const remMonths = Math.round(months % 12);
    shortLabel = `~${days} dias (~${years} ano${years > 1 ? "s" : ""}${
      remMonths ? ` e ${remMonths} meses` : ""
    })`;
  }

  return {
    days,
    months,
    postsPerDay,
    label: `${count} vídeo(s) em ${shortLabel} (${postsPerDay} posts/dia)`,
    shortLabel,
  };
}

export function buildSmartScheduleSlice(params: {
  mode: ScheduleMode;
  offset: number;
  count: number;
  totalCount: number;
  now?: Date;
  warmup?: WarmupScheduleOptions;
  custom?: CustomScheduleOptions;
  auto?: AutoScheduleOptions;
}) {
  const full = buildSmartSchedule(
    params.mode,
    params.totalCount,
    params.now,
    params.warmup,
    params.custom,
    params.auto,
  );
  const schedule = full.schedule.slice(params.offset, params.offset + params.count);

  if (schedule.length < params.count) {
    if (params.mode === "today") {
      throw new Error(
        `Só há espaço para ${schedule.length} post(s) hoje. Use "Automático" para distribuir em vários dias.`,
      );
    }
    throw new Error("Não foi possível calcular os horários. Tente com menos vídeos.");
  }

  const duration =
    params.mode === "warmup"
      ? estimateScheduleDuration(params.totalCount, "warmup", params.warmup?.warmupDays)
      : params.mode === "custom"
        ? estimateScheduleDuration(params.totalCount, "custom", DEFAULT_WARMUP_DAYS, params.custom)
        : estimateScheduleDuration(params.totalCount, "auto", DEFAULT_WARMUP_DAYS, undefined, params.auto);

  const autoProfileLabel =
    params.auto?.profile === "new"
      ? "Conta nova · aquecimento 3→3→4→4→7"
      : params.auto?.profile === "strong"
        ? `${full.postsPerDay} posts/dia (conta forte)`
        : params.auto?.profile === "growing"
          ? `${full.postsPerDay} posts/dia (conta em crescimento)`
          : `${full.postsPerDay} posts/dia`;

  const schedule_summary =
    params.mode === "warmup"
      ? `${describeWarmupPlan(params.warmup?.warmupDays)} · ${describeSmartSchedule(full.schedule, "auto")}`
      : params.mode === "custom"
        ? `${full.postsPerDay} posts/dia · ${describeSmartSchedule(full.schedule, "auto")}`
        : params.mode === "auto"
          ? `${autoProfileLabel} · ${describeSmartSchedule(full.schedule, "auto")}`
          : describeSmartSchedule(full.schedule, params.mode);

  const warmup_breakdown =
    params.mode === "warmup" || params.mode === "auto"
      ? groupWarmupScheduleByDay(full.schedule)
      : undefined;

  return {
    schedule,
    postsPerDay: full.postsPerDay,
    mode: params.mode,
    duration,
    schedule_summary,
    warmup_breakdown,
  };
}

export function describeSmartSchedule(schedule: Date[], mode: ScheduleMode = "today") {
  if (!schedule.length) return "Nenhum horário disponível";

  const dateTimeFmt = new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: APP_TIMEZONE,
  });

  const first = schedule[0];
  const last = schedule[schedule.length - 1];

  if (mode === "today") {
    const timeFmt = new Intl.DateTimeFormat("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: APP_TIMEZONE,
    });
    return `${schedule.length} posts hoje entre ${timeFmt.format(first)} e ${timeFmt.format(last)}`;
  }

  const dayMs = 86_400_000;
  const days = Math.max(1, Math.ceil((last.getTime() - first.getTime()) / dayMs) + 1);
  const dayLabel = days === 1 ? "1 dia" : `~${days} dias`;
  return `${schedule.length} posts em ${dayLabel} (${dateTimeFmt.format(first)} → ${dateTimeFmt.format(last)})`;
}
