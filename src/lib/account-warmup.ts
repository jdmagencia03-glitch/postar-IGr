import { addDays, setHours, setMinutes, setSeconds } from "date-fns";

export const DEFAULT_WARMUP_DAYS = 5;
export const MIN_WARMUP_DAYS = 2;
export const MAX_WARMUP_DAYS = 5;

const BUFFER_MINUTES = 15;

function resolveAutoPostsPerDay(videoCount: number) {
  if (videoCount <= 7) return 1;
  if (videoCount <= 30) return 2;
  return 3;
}

/** Horários mais seguros para contas novas (evita padrão de spam) */
const WARMUP_HOURS = {
  1: [19],
  2: [12, 19],
  3: [11, 15, 20],
} as const;

const STEADY_HOURS = {
  1: [18],
  2: [12, 19],
  3: [9, 14, 20],
} as const;

export function clampWarmupDays(days: number) {
  return Math.min(MAX_WARMUP_DAYS, Math.max(MIN_WARMUP_DAYS, Math.round(days)));
}

/** Rampa de posts/dia: dias 1–5 começam devagar */
export function buildWarmupRamp(totalDays: number): number[] {
  const days = clampWarmupDays(totalDays);
  if (days <= 2) return [1, 2];
  if (days === 3) return [1, 1, 2];
  if (days === 4) return [1, 1, 2, 2];
  return [1, 1, 2, 2, 3];
}

export function getWarmupDayOffset(warmupStartedAt: string | Date | null, now = new Date()) {
  if (!warmupStartedAt) return 0;
  const start = new Date(warmupStartedAt);
  start.setHours(0, 0, 0, 0);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  return Math.max(0, Math.floor((today.getTime() - start.getTime()) / 86_400_000));
}

export function isWarmupActive(params: {
  warmupEnabled: boolean;
  warmupStartedAt: string | Date | null;
  warmupDays: number;
  now?: Date;
}) {
  if (!params.warmupEnabled) return false;
  const offset = getWarmupDayOffset(params.warmupStartedAt, params.now);
  return offset < clampWarmupDays(params.warmupDays);
}

export function getWarmupStatus(params: {
  warmupEnabled: boolean;
  warmupStartedAt: string | Date | null;
  warmupDays: number;
  now?: Date;
}) {
  const days = clampWarmupDays(params.warmupDays);
  const offset = getWarmupDayOffset(params.warmupStartedAt, params.now);

  if (!params.warmupEnabled) {
    return { active: false, day: 0, totalDays: days, label: "Desativado" };
  }

  if (offset >= days) {
    return { active: false, day: days, totalDays: days, label: "Aquecimento concluído" };
  }

  return {
    active: true,
    day: offset + 1,
    totalDays: days,
    label: `Aquecimento dia ${offset + 1}/${days}`,
  };
}

function atHour(base: Date, hour: number) {
  return setSeconds(setMinutes(setHours(base, hour), 0), 0);
}

function resolveStartDate(now = new Date()) {
  const earliest = new Date(now.getTime() + BUFFER_MINUTES * 60_000);
  const endToday = new Date(now);
  endToday.setHours(23, 0, 0, 0);

  if (earliest < endToday) {
    return new Date(earliest);
  }

  const tomorrow = addDays(now, 1);
  return atHour(tomorrow, WARMUP_HOURS[1][0]);
}

function hoursForDay(postsPerDay: number, inWarmupRamp: boolean) {
  const table = inWarmupRamp ? WARMUP_HOURS : STEADY_HOURS;
  return table[postsPerDay as 1 | 2 | 3] ?? table[1];
}

export function generateWarmupSchedule(params: {
  count: number;
  warmupDays?: number;
  warmupDayOffset?: number;
  now?: Date;
}) {
  const count = params.count;
  if (count <= 0) return [];

  const warmupDays = clampWarmupDays(params.warmupDays ?? DEFAULT_WARMUP_DAYS);
  const warmupDayOffset = params.warmupDayOffset ?? 0;
  const ramp = buildWarmupRamp(warmupDays);
  const steadyPostsPerDay = resolveAutoPostsPerDay(count);
  const startDate = resolveStartDate(params.now);

  const schedule: Date[] = [];
  let calendarDay = 0;

  while (schedule.length < count) {
    const absoluteWarmupDay = warmupDayOffset + calendarDay;
    const inRamp = absoluteWarmupDay < ramp.length;
    const postsToday = inRamp ? ramp[absoluteWarmupDay] : steadyPostsPerDay;
    const hours = hoursForDay(postsToday, inRamp);
    const dayBase = addDays(startDate, calendarDay);
    dayBase.setHours(0, 0, 0, 0);

    for (let slot = 0; slot < postsToday && schedule.length < count; slot++) {
      const hour = hours[slot % hours.length];
      let scheduled = atHour(dayBase, hour);

      if (calendarDay === 0 && scheduled < startDate) {
        scheduled = atHour(dayBase, hours[hours.length - 1]);
        if (scheduled < startDate) {
          scheduled = new Date(startDate.getTime() + slot * 30 * 60_000);
        }
      }

      schedule.push(scheduled);
    }

    calendarDay++;
  }

  return schedule;
}

export function estimateWarmupDuration(count: number, warmupDays = DEFAULT_WARMUP_DAYS) {
  const days = clampWarmupDays(warmupDays);
  const ramp = buildWarmupRamp(days);
  const steady = resolveAutoPostsPerDay(count);

  let remaining = count;
  let totalDays = 0;

  for (const posts of ramp) {
    if (remaining <= 0) break;
    remaining -= posts;
    totalDays++;
  }

  while (remaining > 0) {
    remaining -= steady;
    totalDays++;
  }

  const months = Math.round((totalDays / 30) * 10) / 10;
  const rampLabel = ramp.join("→");

  return {
    days: totalDays,
    months,
    rampLabel,
    label: `${count} vídeo(s) em ~${totalDays} dias com aquecimento (${rampLabel} posts/dia, depois ${steady}/dia)`,
    shortLabel: `~${totalDays} dias (aquecimento ${days}d)`,
  };
}

export function describeWarmupPlan(warmupDays = DEFAULT_WARMUP_DAYS) {
  const ramp = buildWarmupRamp(warmupDays);
  return `Aquecimento ${warmupDays} dias: ${ramp.map((n, i) => `D${i + 1}=${n}`).join(", ")}, depois até 3/dia`;
}
