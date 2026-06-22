import {
  APP_TIMEZONE,
  atHourInAppTz,
  atHourOnDayOffsetInAppTz,
  getAppDateParts,
  zonedDateTimeToUtc,
} from "@/lib/timezone";

export type WarmupScheduleStrategy = "continue" | "new_plan" | "fill_gaps";

export type WarmupScheduleContext = {
  warmupDayOffset: number;
  firstScheduledAt: Date;
  warmupStartDate: string;
};

export type WarmupSlotValidationError = {
  ok: false;
  code: "invalid_warmup_slot";
  invalidSlot: string;
  dayIndex: number;
  allowedSlots: string[];
  scheduledAt: string;
};

export type WarmupSlotValidationOk = {
  ok: true;
  dayIndex: number;
  slot: string;
  localDate: string;
};

export type WarmupDiagnosticsPlannedPost = {
  scheduledAt: string;
  localDate: string;
  localTime: string;
  dayIndex: number;
  slot: string;
  slotSource: "warmup_fixed";
  isValidWarmupSlot: boolean;
};

export type WarmupInvalidSlotReport = {
  scheduledAt: string;
  localTime: string;
  dayIndex: number;
  reason: "not_in_warmup_fixed_grid";
};

export const DEFAULT_WARMUP_DAYS = 5;
export const MIN_WARMUP_DAYS = 2;
export const MAX_WARMUP_DAYS = 5;
export const EXTENDED_PROTECTION_DAYS = 14;
export const MAX_SAFE_POSTS_PER_DAY = 2;
export const MAX_SAFE_TODAY_POSTS = 1;
export const POST_WARMUP_POSTS_PER_DAY = 7;

/** Primeiros 5 dias do aquecimento: total 21 vídeos */
export const WARMUP_RAMP_POSTS = [3, 3, 4, 4, 7] as const;

export const WARMUP_MODE_SHORT_DESCRIPTION =
  "Ideal para contas recém-criadas. Começa devagar e aumenta gradualmente.";

export const WARMUP_MODE_EXPANDED_DESCRIPTION =
  "Programa os primeiros 5 dias com ritmo seguro: 3 posts no Dia 1, 3 no Dia 2, 4 no Dia 3, 4 no Dia 4 e 7 no Dia 5. Ideal para aquecer contas novas sem começar agressivo demais. Após o Dia 5, continua com 7 posts por dia.";

export const AUTO_MODE_SHORT_DESCRIPTION =
  "A plataforma distribui seus vídeos automaticamente nos melhores horários, respeitando o perfil da conta, evitando horários passados e mantendo uma frequência segura.";

export const AUTO_PROFILE_LABELS = {
  new: "Conta nova",
  growing: "Conta em crescimento",
  strong: "Conta forte",
} as const;

export const AUTO_PROFILE_DESCRIPTIONS = {
  new: "Aquecimento seguro: 3 posts no Dia 1, 3 no Dia 2, 4 no Dia 3, 4 no Dia 4 e 7 no Dia 5.",
  growing: "7 a 10 posts por dia, horários distribuídos entre manhã, tarde e noite.",
  strong: "10 a 15 posts por dia, com intervalos mínimos ao longo do dia.",
} as const;

export type AutoAccountProfile = keyof typeof AUTO_PROFILE_LABELS;

type TimeSlot = { hour: number; minute: number };

/** Grade fixa do aquecimento — Dia 1 a Dia 5+. */
export const WARMUP_PATTERN = "3→3→4→4→7" as const;

/** Horários fixos por dia de aquecimento (índice 0 = Dia 1). */
export const WARMUP_DAY_TIME_SLOTS: readonly (readonly TimeSlot[])[] = [
  [
    { hour: 8, minute: 30 },
    { hour: 14, minute: 30 },
    { hour: 21, minute: 0 },
  ],
  [
    { hour: 8, minute: 30 },
    { hour: 14, minute: 30 },
    { hour: 21, minute: 0 },
  ],
  [
    { hour: 8, minute: 0 },
    { hour: 12, minute: 30 },
    { hour: 17, minute: 0 },
    { hour: 21, minute: 30 },
  ],
  [
    { hour: 8, minute: 0 },
    { hour: 12, minute: 30 },
    { hour: 17, minute: 0 },
    { hour: 21, minute: 30 },
  ],
  [
    { hour: 7, minute: 0 },
    { hour: 10, minute: 0 },
    { hour: 13, minute: 0 },
    { hour: 16, minute: 0 },
    { hour: 18, minute: 30 },
    { hour: 21, minute: 0 },
    { hour: 23, minute: 0 },
  ],
] as const;

export const POST_WARMUP_TIME_SLOTS: readonly TimeSlot[] = WARMUP_DAY_TIME_SLOTS[4];

/** Horários fixos para um dia absoluto da rampa (1 = Dia 1 … 5+ = grade de 7 posts). */
export function getWarmupSlotsForDay(dayIndex: number): TimeSlot[] {
  const zeroBased = Math.max(0, dayIndex - 1);
  if (zeroBased < 4) {
    return [...WARMUP_DAY_TIME_SLOTS[zeroBased]];
  }
  return [...WARMUP_DAY_TIME_SLOTS[4]];
}

/** Ancora o Dia 1 no dia local atual (00:00 em America/Sao_Paulo). */
export function resolveNewWarmupAnchorDate(now = new Date()): Date {
  const parts = getAppDateParts(now);
  return zonedDateTimeToUtc(parts.year, parts.month, parts.day, 0, 0);
}

/** Contexto de planejamento — nunca usa histórico da conta para dayIndex. */
export function resolveWarmupScheduleContext(params: {
  strategy: WarmupScheduleStrategy;
  anchorStartDate?: Date;
  now?: Date;
}): WarmupScheduleContext {
  const now = params.now ?? new Date();

  if (params.strategy === "new_plan" || !params.anchorStartDate) {
    const firstScheduledAt = resolveNewWarmupAnchorDate(now);
    return {
      warmupDayOffset: 0,
      firstScheduledAt,
      warmupStartDate: warmupDateKey(firstScheduledAt),
    };
  }

  return {
    warmupDayOffset: 0,
    firstScheduledAt: params.anchorStartDate,
    warmupStartDate: warmupDateKey(params.anchorStartDate),
  };
}

export function warmupDayIndexFromStart(warmupStartDate: string, date: Date): number {
  const [year, month, day] = warmupStartDate.split("-").map(Number);
  const startUtc = Date.UTC(year, month - 1, day);
  const parts = getAppDateParts(date);
  const dateUtc = Date.UTC(parts.year, parts.month - 1, parts.day);
  return Math.max(1, Math.round((dateUtc - startUtc) / 86_400_000) + 1);
}

export function allowedWarmupSlotsForDayIndex(dayIndex: number): string[] {
  return getWarmupSlotsForDay(dayIndex).map(formatWarmupTimeSlot);
}

export function isValidWarmupSlot(dayIndex: number, localTime: string): boolean {
  return allowedWarmupSlotsForDayIndex(dayIndex).includes(localTime);
}

export function validateWarmupScheduledAt(
  scheduledAt: string | Date,
  warmupStartDate: string,
): WarmupSlotValidationOk | WarmupSlotValidationError {
  const date = new Date(scheduledAt);
  const parts = getAppDateParts(date);
  const slot = formatWarmupTimeSlot({ hour: parts.hour, minute: parts.minute });
  const dayIndex = warmupDayIndexFromStart(warmupStartDate, date);
  const localDate = warmupDateKey(date);

  if (!isValidWarmupSlot(dayIndex, slot)) {
    return {
      ok: false,
      code: "invalid_warmup_slot",
      invalidSlot: slot,
      dayIndex,
      allowedSlots: allowedWarmupSlotsForDayIndex(dayIndex),
      scheduledAt: date.toISOString(),
    };
  }

  return { ok: true, dayIndex, slot, localDate };
}

export function buildWarmupDiagnosticsPlannedPosts(
  schedule: Date[],
  warmupStartDate: string,
): WarmupDiagnosticsPlannedPost[] {
  return schedule.map((scheduledAt) => {
    const parts = getAppDateParts(scheduledAt);
    const localTime = formatWarmupTimeSlot({ hour: parts.hour, minute: parts.minute });
    const localDate = warmupDateKey(scheduledAt);
    const dayIndex = warmupDayIndexFromStart(warmupStartDate, scheduledAt);
    return {
      scheduledAt: scheduledAt.toISOString(),
      localDate,
      localTime,
      dayIndex,
      slot: localTime,
      slotSource: "warmup_fixed" as const,
      isValidWarmupSlot: isValidWarmupSlot(dayIndex, localTime),
    };
  });
}

export function detectInvalidWarmupSlots(
  scheduledAts: string[],
  warmupStartDate: string,
): WarmupInvalidSlotReport[] {
  const invalid: WarmupInvalidSlotReport[] = [];
  for (const scheduledAt of scheduledAts) {
    const validation = validateWarmupScheduledAt(scheduledAt, warmupStartDate);
    if (!validation.ok) {
      const parts = getAppDateParts(new Date(scheduledAt));
      invalid.push({
        scheduledAt,
        localTime: formatWarmupTimeSlot({ hour: parts.hour, minute: parts.minute }),
        dayIndex: validation.dayIndex,
        reason: "not_in_warmup_fixed_grid",
      });
    }
  }
  return invalid;
}

/** @deprecated Use getWarmupSlotsForDay — mantido para compatibilidade interna. */
export const WARMUP_PHASE_TIME_SLOTS = {
  3: WARMUP_DAY_TIME_SLOTS[0],
  4: WARMUP_DAY_TIME_SLOTS[2],
  7: POST_WARMUP_TIME_SLOTS,
} as const;

const BUFFER_MINUTES = 15;

export function warmupDateKey(date: Date) {
  const parts = getAppDateParts(date);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

export function slotsForPostsPerDay(postsPerDay: number): TimeSlot[] {
  if (postsPerDay >= POST_WARMUP_POSTS_PER_DAY) {
    return getWarmupSlotsForDay(5);
  }
  if (postsPerDay === 4) {
    return getWarmupSlotsForDay(3);
  }
  return getWarmupSlotsForDay(1).slice(0, Math.max(1, Math.min(3, postsPerDay)));
}

export type WarmupCalendarStart = {
  warmupStartDate: string;
  calendarStart: Date;
  partialFirstDay: boolean;
  slotCutoff: Date;
  firstScheduledAt: Date;
};

/** Ancora a rampa no dia local do primeiro post, não no horário exato do slot. */
export function resolveWarmupCalendarStart(params: {
  firstScheduledAt: Date;
  now?: Date;
}): WarmupCalendarStart {
  const now = params.now ?? new Date();
  const firstParts = getAppDateParts(params.firstScheduledAt);
  const todayParts = getAppDateParts(now);

  const calendarStart = zonedDateTimeToUtc(
    firstParts.year,
    firstParts.month,
    firstParts.day,
    0,
    0,
  );

  const sameLocalDay =
    firstParts.year === todayParts.year &&
    firstParts.month === todayParts.month &&
    firstParts.day === todayParts.day;

  const partialFirstDay = sameLocalDay;
  const earliest = new Date(now.getTime() + BUFFER_MINUTES * 60_000);
  const slotCutoff = partialFirstDay ? earliest : calendarStart;

  return {
    warmupStartDate: warmupDateKey(params.firstScheduledAt),
    calendarStart,
    partialFirstDay,
    slotCutoff,
    firstScheduledAt: params.firstScheduledAt,
  };
}

export type WarmupDayBreakdown = {
  day: number;
  posts: number;
  times: string[];
};

export function formatWarmupTimeSlot(slot: TimeSlot) {
  return `${String(slot.hour).padStart(2, "0")}:${String(slot.minute).padStart(2, "0")}`;
}

export function clampWarmupDays(days: number) {
  return Math.min(MAX_WARMUP_DAYS, Math.max(MIN_WARMUP_DAYS, Math.round(days)));
}

/** Rampa dos primeiros dias: 3, 3, 4, 4, 7 (truncada se warmup_days < 5). */
export function buildWarmupRamp(totalDays: number): number[] {
  return [...WARMUP_RAMP_POSTS.slice(0, clampWarmupDays(totalDays))];
}

export function describeWarmupDayPlan(warmupDays = DEFAULT_WARMUP_DAYS): WarmupDayBreakdown[] {
  const ramp = buildWarmupRamp(warmupDays);
  return ramp.map((posts, index) => ({
    day: index + 1,
    posts,
    times: slotsForPostsPerDay(posts).map(formatWarmupTimeSlot),
  }));
}

function slotsForAbsoluteDay(absoluteDay: number, _rampLength: number): TimeSlot[] {
  return getWarmupSlotsForDay(absoluteDay + 1);
}

export type WarmupSkippedSlot = {
  date: string;
  time: string;
  reason: "past_time";
};

export type WarmupPlannedPost = {
  dayIndex: number;
  scheduledAt: string;
  slot: string;
  slotSource: "warmup_fixed";
};

export type WarmupSchedulePlanResult = {
  schedule: Date[];
  skippedPastSlots: WarmupSkippedSlot[];
  plannedPosts: WarmupPlannedPost[];
  warnings: string[];
  planningMeta?: WarmupPlanningMeta;
};

export type WarmupPlanningMeta = {
  existingValidPostsToday: number;
  remainingSlotsToday: number;
  warmupStartDate: string;
  effectiveFirstScheduledDate: string | null;
  timezone: typeof APP_TIMEZONE;
};

/** Limite de posts por dia da rampa (1 = Dia 1). */
export function getWarmupDailyPostLimit(rampDayIndex: number): number {
  if (rampDayIndex <= 2) return 3;
  if (rampDayIndex <= 4) return 4;
  return POST_WARMUP_POSTS_PER_DAY;
}

function calendarLocalDateKey(calendarStart: Date, calendarDay: number) {
  return warmupDateKey(atHourOnDayOffsetInAppTz(calendarStart, calendarDay, 0, 0));
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
      "Muitos vídeos em Automático numa conta nova pode ser agressivo. Considere Aquecimento (3→3→4→4→7 nos primeiros 5 dias).",
    );
  }

  if (params.scheduleMode === "warmup") {
    warnings.push("Modo Aquecimento ativo — ritmo gradual 3→3→4→4→7 nos primeiros 5 dias.");
  }

  return {
    blocked: false,
    requiresWarmup: protectedAccounts.length > 0,
    warnings,
    protected_count: protectedAccounts.length,
  };
}

function resolveStartDate(now = new Date()) {
  const earliest = new Date(now.getTime() + BUFFER_MINUTES * 60_000);
  const endToday = atHourInAppTz(now, 23, 59);

  if (earliest <= endToday) {
    return earliest;
  }

  const first = getWarmupSlotsForDay(1)[0];
  return atHourOnDayOffsetInAppTz(now, 1, first.hour, first.minute);
}

function buildPlannedPostsFromSchedule(schedule: Date[]): WarmupPlannedPost[] {
  if (!schedule.length) return [];

  const firstParts = getAppDateParts(schedule[0]);
  const startDayUtc = Date.UTC(firstParts.year, firstParts.month - 1, firstParts.day);

  return schedule.map((scheduledAt) => {
    const parts = getAppDateParts(scheduledAt);
    const slotDayUtc = Date.UTC(parts.year, parts.month - 1, parts.day);
    const dayIndex = Math.max(1, Math.round((slotDayUtc - startDayUtc) / 86_400_000) + 1);
    return {
      dayIndex,
      scheduledAt: scheduledAt.toISOString(),
      slot: formatWarmupTimeSlot({ hour: parts.hour, minute: parts.minute }),
      slotSource: "warmup_fixed" as const,
    };
  });
}

export function buildWarmupSchedulePlan(params: {
  count: number;
  warmupDays?: number;
  warmupDayOffset?: number;
  firstScheduledAt?: Date;
  startDate?: Date;
  now?: Date;
  /** Posts válidos já existentes por data local (YYYY-MM-DD). */
  existingValidPostsByLocalDate?: Record<string, number>;
}): WarmupSchedulePlanResult {
  const count = params.count;
  const warnings: string[] = [];
  const skippedPastSlots: WarmupSkippedSlot[] = [];

  if (count <= 0) {
    return { schedule: [], skippedPastSlots, plannedPosts: [], warnings };
  }

  const warmupDayOffset = params.warmupDayOffset ?? 0;
  const now = params.now ?? new Date();
  const todayKey = warmupDateKey(now);
  const anchorSource =
    params.firstScheduledAt ?? params.startDate ?? resolveNewWarmupAnchorDate(now);
  const calendar = resolveWarmupCalendarStart({ firstScheduledAt: anchorSource, now });
  const existingByDate = params.existingValidPostsByLocalDate ?? {};

  const schedule: Date[] = [];
  let calendarDay = 0;
  const maxCalendarDays = Math.max(count * 2, 60);

  while (schedule.length < count && calendarDay < maxCalendarDays) {
    const absoluteWarmupDay = warmupDayOffset + calendarDay;
    const rampDayIndex = absoluteWarmupDay + 1;
    const dailyLimit = getWarmupDailyPostLimit(rampDayIndex);
    const dayKey = calendarLocalDateKey(calendar.calendarStart, calendarDay);
    const existingOnDay = existingByDate[dayKey] ?? 0;
    const remainingCapacity = Math.max(0, dailyLimit - existingOnDay);

    if (remainingCapacity === 0) {
      if (existingOnDay > 0) {
        warnings.push(
          `Dia ${dayKey}: ${existingOnDay} post(s) já ocupam a meta do Dia ${rampDayIndex} (${dailyLimit}). Próximos vídeos começam no dia seguinte.`,
        );
      }
      calendarDay++;
      continue;
    }

    const slotTimes = slotsForAbsoluteDay(absoluteWarmupDay, 0);
    let scheduledOnDay = 0;

    for (let slotIndex = 0; slotIndex < slotTimes.length; slotIndex++) {
      if (schedule.length >= count) break;
      if (scheduledOnDay >= remainingCapacity) break;

      const { hour, minute } = slotTimes[slotIndex]!;

      const scheduled = atHourOnDayOffsetInAppTz(
        calendar.calendarStart,
        calendarDay,
        hour,
        minute,
      );

      if (calendar.partialFirstDay && calendarDay === 0 && scheduled < calendar.slotCutoff) {
        skippedPastSlots.push({
          date: warmupDateKey(scheduled),
          time: formatWarmupTimeSlot({ hour, minute }),
          reason: "past_time",
        });
        continue;
      }

      if (slotIndex < existingOnDay) {
        continue;
      }

      schedule.push(scheduled);
      scheduledOnDay++;
    }

    calendarDay++;
  }

  if (skippedPastSlots.length) {
    const times = skippedPastSlots.map((slot) => slot.time).join(", ");
    warnings.push(
      `${skippedPastSlots.length} horário(s) de hoje foram ignorados porque já passaram: ${times}.`,
    );
  }

  const startDayKey = calendar.warmupStartDate;
  const existingOnStartDay = existingByDate[startDayKey] ?? existingByDate[todayKey] ?? 0;
  const remainingSlotsToday = Math.max(
    0,
    getWarmupDailyPostLimit(1) - (existingByDate[todayKey] ?? existingOnStartDay),
  );

  return {
    schedule,
    skippedPastSlots,
    plannedPosts: buildPlannedPostsFromSchedule(schedule),
    warnings,
    planningMeta: {
      existingValidPostsToday: existingByDate[todayKey] ?? existingOnStartDay,
      remainingSlotsToday,
      warmupStartDate: startDayKey,
      effectiveFirstScheduledDate: schedule[0] ? warmupDateKey(schedule[0]) : null,
      timezone: APP_TIMEZONE,
    },
  };
}

export function generateWarmupSchedule(params: {
  count: number;
  warmupDays?: number;
  warmupDayOffset?: number;
  /** @deprecated Prefer firstScheduledAt — ancora pelo dia local, não pelo horário exato. */
  startDate?: Date;
  /** Primeiro post da fila/lote; define o dia 1 da rampa. */
  firstScheduledAt?: Date;
  now?: Date;
  /** Recebe avisos sobre horários passados. */
  warnings?: string[];
}) {
  const plan = buildWarmupSchedulePlan(params);
  if (params.warnings && plan.warnings.length) {
    params.warnings.push(...plan.warnings);
  }
  return plan.schedule;
}

/** Gera apenas os slots novos, continuando a sequência do plano (ex.: 10 já agendados → offset 10). */
export function generateWarmupScheduleSlice(params: {
  count: number;
  planSlotOffset?: number;
  warmupDays?: number;
  warmupDayOffset?: number;
  startDate?: Date;
  firstScheduledAt?: Date;
  now?: Date;
  warnings?: string[];
}) {
  const offset = params.planSlotOffset ?? 0;
  const total = offset + params.count;
  const plan = buildWarmupSchedulePlan({ ...params, count: total });
  if (params.warnings && plan.warnings.length) {
    params.warnings.push(...plan.warnings);
  }
  return plan.schedule.slice(offset);
}

export function generateWarmupScheduleSliceWithPlan(params: {
  count: number;
  planSlotOffset?: number;
  warmupDays?: number;
  warmupDayOffset?: number;
  startDate?: Date;
  firstScheduledAt?: Date;
  now?: Date;
  warnings?: string[];
  existingValidPostsByLocalDate?: Record<string, number>;
}): WarmupSchedulePlanResult {
  const offset = params.planSlotOffset ?? 0;
  const total = offset + params.count;
  const plan = buildWarmupSchedulePlan({ ...params, count: total });
  if (params.warnings && plan.warnings.length) {
    params.warnings.push(...plan.warnings);
  }
  return {
    schedule: plan.schedule.slice(offset),
    skippedPastSlots: plan.skippedPastSlots,
    plannedPosts: plan.plannedPosts.slice(offset),
    warnings: plan.warnings,
    planningMeta: plan.planningMeta,
  };
}

export function groupWarmupScheduleByDay(
  schedule: Date[],
): Array<{ day: number; dateLabel: string; posts: number; times: string[] }> {
  if (!schedule.length) return [];

  const firstParts = getAppDateParts(schedule[0]);
  const startDayUtc = Date.UTC(firstParts.year, firstParts.month - 1, firstParts.day);
  const groups = new Map<number, Date[]>();

  for (const slot of schedule) {
    const parts = getAppDateParts(slot);
    const slotDayUtc = Date.UTC(parts.year, parts.month - 1, parts.day);
    const dayIndex = Math.max(0, Math.round((slotDayUtc - startDayUtc) / 86_400_000)) + 1;
    const list = groups.get(dayIndex) ?? [];
    list.push(slot);
    groups.set(dayIndex, list);
  }

  return [...groups.entries()]
    .sort(([a], [b]) => a - b)
    .map(([day, slots]) => ({
      day,
      dateLabel: slots[0].toLocaleDateString("pt-BR", {
        timeZone: "America/Sao_Paulo",
        day: "2-digit",
        month: "2-digit",
      }),
      posts: slots.length,
      times: slots.map((slot) => {
        const parts = getAppDateParts(slot);
        return formatWarmupTimeSlot({ hour: parts.hour, minute: parts.minute });
      }),
    }));
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
    remaining -= POST_WARMUP_POSTS_PER_DAY;
    totalDays++;
    absoluteDay++;
  }

  const months = Math.round((totalDays / 30) * 10) / 10;
  const rampLabel = ramp.join("→");

  return {
    days: totalDays,
    months,
    rampLabel,
    label: `${count} posts em ~${totalDays} dias (Aquecimento ${rampLabel})`,
    shortLabel: `~${totalDays} dias (Aquecimento ${rampLabel})`,
  };
}

export function describeWarmupPlan(warmupDays = DEFAULT_WARMUP_DAYS) {
  const ramp = buildWarmupRamp(warmupDays);
  return `Aquecimento ${WARMUP_PATTERN}: ${ramp.map((n, i) => `D${i + 1}=${n}`).join(", ")} · depois ${POST_WARMUP_POSTS_PER_DAY}/dia`;
}

export function inferAutoAccountProfile(
  account: {
    warmup_enabled?: boolean;
    warmup_started_at?: string | null;
    warmup_days?: number;
    created_at: string;
  },
  now = new Date(),
): AutoAccountProfile {
  const warmupEnabled = account.warmup_enabled ?? true;
  const warmupDays = clampWarmupDays(account.warmup_days ?? DEFAULT_WARMUP_DAYS);
  const warmupStartedAt = account.warmup_started_at ?? account.created_at;

  if (
    warmupEnabled &&
    (isWarmupActive({
      warmupEnabled,
      warmupStartedAt,
      warmupDays,
      now,
    }) ||
      isInProtectionPeriod({ warmupEnabled, warmupStartedAt, now }))
  ) {
    return "new";
  }

  const offset = getWarmupDayOffset(warmupStartedAt, now);
  if (offset < EXTENDED_PROTECTION_DAYS) {
    return "growing";
  }

  return "strong";
}

export function resolveAutoScheduleOptions(params: {
  profile?: AutoAccountProfile;
  igAccount?: {
    warmup_enabled?: boolean;
    warmup_started_at?: string | null;
    warmup_days?: number;
    created_at: string;
  } | null;
}): {
  profile: AutoAccountProfile;
  warmup?: { warmupDays?: number; warmupDayOffset?: number };
} {
  const profile =
    params.profile ??
    (params.igAccount ? inferAutoAccountProfile(params.igAccount) : "growing");

  if (profile !== "new") {
    return { profile };
  }

  if (params.igAccount) {
    return {
      profile,
      warmup: {
        warmupDays: params.igAccount.warmup_days ?? DEFAULT_WARMUP_DAYS,
        warmupDayOffset: getWarmupDayOffset(
          params.igAccount.warmup_started_at ?? params.igAccount.created_at,
        ),
      },
    };
  }

  return {
    profile,
    warmup: { warmupDays: DEFAULT_WARMUP_DAYS, warmupDayOffset: 0 },
  };
}
