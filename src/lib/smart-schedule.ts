import { addDays } from "date-fns";
import {
  DEFAULT_WARMUP_DAYS,
  describeWarmupPlan,
  estimateWarmupDuration,
  generateWarmupSchedule,
} from "@/lib/account-warmup";
import { generateBulkSchedule } from "@/lib/utils";

const PEAK_HOURS_BR = [7, 9, 11, 12, 14, 16, 18, 19, 20, 21];
const MIN_GAP_MINUTES = 25;
const BUFFER_MINUTES = 15;

const HOURS_BY_POSTS_PER_DAY: Record<number, number[]> = {
  1: [18],
  2: [12, 19],
  3: [9, 14, 20],
};

export type ScheduleMode = "today" | "auto" | "warmup" | "custom";

export interface CustomScheduleOptions {
  postsPerDay: number;
  timeSlots: Array<{ hour: number; minute: number }>;
}

export interface WarmupScheduleOptions {
  warmupDays?: number;
  warmupDayOffset?: number;
}

function atHour(base: Date, hour: number, minute = 0) {
  const slot = new Date(base);
  slot.setHours(hour, minute, 0, 0);
  return slot;
}

function endOfPostingDay(base: Date) {
  const end = new Date(base);
  end.setHours(23, 30, 0, 0);
  return end;
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
  const { postsPerDay, timeSlots } = options;
  if (count <= 0 || !timeSlots.length || postsPerDay < 1) {
    return { schedule: [] as Date[], postsPerDay };
  }

  const earliest = new Date(now.getTime() + BUFFER_MINUTES * 60_000);
  let startDate = atHour(now, 0, 0);

  for (let probeDay = 0; probeDay < 366; probeDay++) {
    const day = addDays(startDate, probeDay);
    const hasFuture = timeSlots.some(
      ({ hour, minute }) => atHour(day, hour, minute) >= earliest,
    );
    if (hasFuture) {
      startDate = day;
      break;
    }
  }

  const schedule: Date[] = [];
  let dayOffset = 0;
  let slot = 0;

  for (let i = 0; i < count; i++) {
    const { hour, minute } = timeSlots[slot % timeSlots.length];
    const day = addDays(startDate, dayOffset);
    schedule.push(atHour(day, hour, minute));

    slot++;
    if (slot % postsPerDay === 0) {
      dayOffset++;
      slot = 0;
    }
  }

  return { schedule, postsPerDay };
}

export function resolveAutoPostsPerDay(videoCount: number) {
  if (videoCount <= 7) return 1;
  if (videoCount <= 30) return 2;
  return 3;
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

export function generateSmartScheduleAuto(count: number, now = new Date()) {
  const postsPerDay = resolveAutoPostsPerDay(count);
  const hours = HOURS_BY_POSTS_PER_DAY[postsPerDay] ?? HOURS_BY_POSTS_PER_DAY[2];
  const earliest = new Date(now.getTime() + BUFFER_MINUTES * 60_000);

  const hasSlotToday = PEAK_HOURS_BR.some((hour) => {
    const slot = atHour(now, hour);
    return slot >= earliest && slot <= endOfPostingDay(now);
  });

  const startDate = hasSlotToday ? earliest : atHour(addDays(now, 1), PEAK_HOURS_BR[0]);
  const schedule = generateBulkSchedule({ count, startDate, postsPerDay, hours });

  return { schedule, postsPerDay };
}

export function buildSmartSchedule(
  mode: ScheduleMode,
  count: number,
  now = new Date(),
  warmup?: WarmupScheduleOptions,
  custom?: CustomScheduleOptions,
) {
  if (mode === "warmup") {
    const schedule = generateWarmupSchedule({
      count,
      warmupDays: warmup?.warmupDays ?? DEFAULT_WARMUP_DAYS,
      warmupDayOffset: warmup?.warmupDayOffset ?? 0,
      now,
    });
    return {
      schedule,
      postsPerDay: 1,
      mode,
    };
  }

  if (mode === "today") {
    const schedule = generateSmartScheduleToday(count, now);
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
    return { schedule, postsPerDay, mode };
  }

  const { schedule, postsPerDay } = generateSmartScheduleAuto(count, now);
  return { schedule, postsPerDay, mode };
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
): ScheduleDurationEstimate {
  if (count <= 0) {
    return { days: 0, months: 0, postsPerDay: 0, label: "", shortLabel: "" };
  }

  if (mode === "warmup") {
    const est = estimateWarmupDuration(count, warmupDays);
    return {
      days: est.days,
      months: est.months,
      postsPerDay: 1,
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

  const postsPerDay = resolveAutoPostsPerDay(count);
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
}) {
  const full = buildSmartSchedule(
    params.mode,
    params.totalCount,
    params.now,
    params.warmup,
    params.custom,
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
        : estimateScheduleDuration(params.totalCount, params.mode);

  const schedule_summary =
    params.mode === "warmup"
      ? `${describeWarmupPlan(params.warmup?.warmupDays)} · ${describeSmartSchedule(full.schedule, "auto")}`
      : params.mode === "custom"
        ? `${full.postsPerDay} posts/dia · ${describeSmartSchedule(full.schedule, "auto")}`
        : describeSmartSchedule(full.schedule, params.mode);

  return {
    schedule,
    postsPerDay: full.postsPerDay,
    mode: params.mode,
    duration,
    schedule_summary,
  };
}

export function describeSmartSchedule(schedule: Date[], mode: ScheduleMode = "today") {
  if (!schedule.length) return "Nenhum horário disponível";

  const dateTimeFmt = new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  });

  const first = schedule[0];
  const last = schedule[schedule.length - 1];

  if (mode === "today") {
    const timeFmt = new Intl.DateTimeFormat("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
    });
    return `${schedule.length} posts hoje entre ${timeFmt.format(first)} e ${timeFmt.format(last)}`;
  }

  const dayMs = 86_400_000;
  const days = Math.max(1, Math.ceil((last.getTime() - first.getTime()) / dayMs) + 1);
  return `${schedule.length} posts em ~${days} dias (${dateTimeFmt.format(first)} → ${dateTimeFmt.format(last)})`;
}
