import { addDays } from "date-fns";
import {
  atHourInAppTz,
  atHourOnDayOffsetInAppTz,
} from "@/lib/timezone";

export const DEFAULT_WARMUP_DAYS = 5;
export const MIN_WARMUP_DAYS = 2;
export const MAX_WARMUP_DAYS = 5;
export const EXTENDED_PROTECTION_DAYS = 14;
export const MAX_SAFE_POSTS_PER_DAY = 2;
export const MAX_SAFE_TODAY_POSTS = 1;
export const MIN_WARMUP_GAP_HOURS = 6;

const BUFFER_MINUTES = 15;

function resolveAutoPostsPerDay(videoCount: number) {
  if (videoCount <= 7) return 1;
  if (videoCount <= 30) return 2;
  return 3;
}

export function resolveSafePostsPerDay(videoCount: number, inProtection = true) {
  const base = resolveAutoPostsPerDay(videoCount);
  if (!inProtection) return base;
  return Math.min(base, MAX_SAFE_POSTS_PER_DAY);
}

/** Horários mais seguros para contas novas (evita padrão de spam) */
const WARMUP_HOURS = {
  1: [19],
  2: [12, 19],
} as const;

const STEADY_HOURS = {
  1: [18],
  2: [12, 19],
} as const;

export function clampWarmupDays(days: number) {
  return Math.min(MAX_WARMUP_DAYS, Math.max(MIN_WARMUP_DAYS, Math.round(days)));
}

/** Rampa conservadora: sem 3 posts/dia na fase de aquecimento */
export function buildWarmupRamp(totalDays: number): number[] {
  const days = clampWarmupDays(totalDays);
  if (days <= 2) return [1, 1];
  if (days === 3) return [1, 1, 1];
  if (days === 4) return [1, 1, 1, 2];
  return [1, 1, 1, 2, 2];
}

export function getWarmupDayOffset(warmupStartedAt: string | Date | null, now = new Date()) {
  if (!warmupStartedAt) return 0;
  const start = new Date(warmupStartedAt);
  start.setHours(0, 0, 0, 0);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  return Math.max(0, Math.floor((today.getTime() - start.getTime()) / 86_400_000));
}

export function isInProtectionPeriod(params: {
  warmupEnabled?: boolean;
  warmupStartedAt: string | Date | null;
  now?: Date;
}) {
  if (params.warmupEnabled === false) return false;
  const offset = getWarmupDayOffset(params.warmupStartedAt, params.now);
  return offset < EXTENDED_PROTECTION_DAYS;
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
    const inProtection = offset < EXTENDED_PROTECTION_DAYS;
    return {
      active: false,
      day: days,
      totalDays: days,
      label: inProtection
        ? `Aquecimento ok · proteção até dia ${EXTENDED_PROTECTION_DAYS}`
        : "Aquecimento concluído",
    };
  }

  return {
    active: true,
    day: offset + 1,
    totalDays: days,
    label: `Aquecimento dia ${offset + 1}/${days}`,
  };
}

export function assessPostingRisk(params: {
  scheduleMode: "today" | "auto" | "warmup";
  videoCount: number;
  accounts: Array<{
    ig_username?: string | null;
    warmup_enabled?: boolean;
    warmup_started_at?: string | null;
    created_at: string;
  }>;
}) {
  const warnings: string[] = [];

  const protectedAccounts = params.accounts.filter((account) =>
    isInProtectionPeriod({
      warmupEnabled: account.warmup_enabled ?? true,
      warmupStartedAt: account.warmup_started_at ?? account.created_at,
    }),
  );

  if (protectedAccounts.length > 0 && params.scheduleMode !== "warmup") {
    warnings.push(
      `${protectedAccounts.length} conta(s) nova(s): o modo Aquecimento reduz risco de ban. Automático/Só hoje ficam disponíveis se você preferir.`,
    );
  }

  if (params.scheduleMode === "today" && params.videoCount > MAX_SAFE_TODAY_POSTS) {
    warnings.push(
      `Postar ${params.videoCount} Reels hoje aumenta muito o risco em páginas novas. Aquecimento distribui aos poucos.`,
    );
  }

  if (params.scheduleMode === "auto" && params.videoCount > 14 && protectedAccounts.length > 0) {
    warnings.push(
      "Muitos vídeos em Automático numa conta nova pode ser agressivo. Considere Aquecimento (1→1→1→2→2 por dia).",
    );
  }

  if (params.scheduleMode === "warmup") {
    warnings.push("Modo Aquecimento ativo — rampa gradual para proteger contas novas.");
  }

  return {
    blocked: false,
    requiresWarmup: protectedAccounts.length > 0,
    warnings,
    protected_count: protectedAccounts.length,
  };
}

function atHour(base: Date, hour: number) {
  return atHourInAppTz(base, hour, 0);
}

function resolveStartDate(now = new Date()) {
  const earliest = new Date(now.getTime() + BUFFER_MINUTES * 60_000);
  const endToday = atHourInAppTz(now, 23, 0);

  if (earliest < endToday) {
    return earliest;
  }

  return atHourOnDayOffsetInAppTz(now, 1, WARMUP_HOURS[1][0]);
}

function hoursForDay(postsPerDay: number, inWarmupRamp: boolean) {
  const capped = Math.min(postsPerDay, 2);
  const table = inWarmupRamp ? WARMUP_HOURS : STEADY_HOURS;
  return table[capped as 1 | 2] ?? table[1];
}

function enforceMinGap(scheduled: Date, previous: Date | undefined, inProtection: boolean) {
  if (!previous || !inProtection) return scheduled;
  const minNext = new Date(previous.getTime() + MIN_WARMUP_GAP_HOURS * 3_600_000);
  return scheduled < minNext ? minNext : scheduled;
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
  const startDate = resolveStartDate(params.now);

  const schedule: Date[] = [];
  let calendarDay = 0;

  while (schedule.length < count) {
    const absoluteWarmupDay = warmupDayOffset + calendarDay;
    const inRamp = absoluteWarmupDay < ramp.length;
    const inProtection = absoluteWarmupDay < EXTENDED_PROTECTION_DAYS;
    const postsToday = inRamp
      ? ramp[absoluteWarmupDay]
      : resolveSafePostsPerDay(count, inProtection);
    const hours = hoursForDay(postsToday, inRamp || inProtection);

    for (let slot = 0; slot < postsToday && schedule.length < count; slot++) {
      const hour = hours[slot % hours.length];
      let scheduled = atHourOnDayOffsetInAppTz(startDate, calendarDay, hour, 0);

      if (calendarDay === 0 && scheduled < startDate) {
        scheduled = atHourOnDayOffsetInAppTz(startDate, calendarDay, hours[hours.length - 1], 0);
        if (scheduled < startDate) {
          scheduled = new Date(startDate.getTime() + slot * MIN_WARMUP_GAP_HOURS * 3_600_000);
        }
      }

      scheduled = enforceMinGap(scheduled, schedule[schedule.length - 1], inProtection);
      schedule.push(scheduled);
    }

    calendarDay++;
  }

  return schedule;
}

export function estimateWarmupDuration(count: number, warmupDays = DEFAULT_WARMUP_DAYS) {
  const days = clampWarmupDays(warmupDays);
  const ramp = buildWarmupRamp(days);

  let remaining = count;
  let totalDays = 0;
  let absoluteDay = 0;

  for (const posts of ramp) {
    if (remaining <= 0) break;
    remaining -= posts;
    totalDays++;
    absoluteDay++;
  }

  while (remaining > 0) {
    const inProtection = absoluteDay < EXTENDED_PROTECTION_DAYS;
    const postsPerDay = resolveSafePostsPerDay(count, inProtection);
    remaining -= postsPerDay;
    totalDays++;
    absoluteDay++;
  }

  const months = Math.round((totalDays / 30) * 10) / 10;
  const rampLabel = ramp.join("→");

  return {
    days: totalDays,
    months,
    rampLabel,
    label: `${count} vídeo(s) em ~${totalDays} dias com proteção anti-ban (${rampLabel} posts/dia, máx ${MAX_SAFE_POSTS_PER_DAY}/dia por ${EXTENDED_PROTECTION_DAYS}d)`,
    shortLabel: `~${totalDays} dias (proteção ${EXTENDED_PROTECTION_DAYS}d)`,
  };
}

export function describeWarmupPlan(warmupDays = DEFAULT_WARMUP_DAYS) {
  const ramp = buildWarmupRamp(warmupDays);
  return `Proteção ${warmupDays}d: ${ramp.map((n, i) => `D${i + 1}=${n}`).join(", ")} · máx ${MAX_SAFE_POSTS_PER_DAY}/dia por ${EXTENDED_PROTECTION_DAYS} dias`;
}
