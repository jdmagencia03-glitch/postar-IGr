import {
  atHourInAppTz,
  atHourOnDayOffsetInAppTz,
  getAppDateParts,
  zonedDateTimeToUtc,
} from "@/lib/timezone";

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

/** Horários sugeridos por dia de aquecimento (Dia 1–5) */
export const WARMUP_DAY_TIME_SLOTS: readonly (readonly TimeSlot[])[] = [
  [
    { hour: 9, minute: 0 },
    { hour: 15, minute: 0 },
    { hour: 20, minute: 30 },
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
    { hour: 7, minute: 30 },
    { hour: 12, minute: 0 },
    { hour: 16, minute: 30 },
    { hour: 21, minute: 0 },
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

/** Mesmos horários para todos os dias com igual volume na rampa (3→3, 4→4, 7→7). */
export const WARMUP_PHASE_TIME_SLOTS = {
  3: WARMUP_DAY_TIME_SLOTS[1],
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
    return [...WARMUP_PHASE_TIME_SLOTS[7]];
  }
  if (postsPerDay === 4) {
    return [...WARMUP_PHASE_TIME_SLOTS[4]];
  }
  const template = [...WARMUP_PHASE_TIME_SLOTS[3]];
  return template.slice(0, Math.max(1, Math.min(3, postsPerDay)));
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

function slotsForAbsoluteDay(absoluteDay: number, rampLength: number): TimeSlot[] {
  if (absoluteDay < rampLength) {
    const postsToday = buildWarmupRamp(rampLength)[absoluteDay] ?? 0;
    return slotsForPostsPerDay(postsToday);
  }
  return slotsForPostsPerDay(POST_WARMUP_POSTS_PER_DAY);
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
  const endToday = atHourInAppTz(now, 23, 0);

  if (earliest < endToday) {
    return earliest;
  }

  const nextDaySlots = WARMUP_DAY_TIME_SLOTS[0];
  const first = nextDaySlots[0];
  return atHourOnDayOffsetInAppTz(now, 1, first.hour, first.minute);
}

function ensureAfterPrevious(scheduled: Date, previous: Date | undefined) {
  if (!previous) return scheduled;
  if (scheduled > previous) return scheduled;
  return new Date(previous.getTime() + 30 * 60_000);
}

const PARTIAL_DAY_MIN_GAP_MS = 30 * 60_000;

function roundUpTo30Minutes(date: Date) {
  const next = new Date(date);
  const mins = next.getMinutes();
  const rounded = Math.ceil(mins / 30) * 30;
  next.setMinutes(rounded, 0, 0);
  return next;
}

function generateEvenlySpacedDaySlots(params: {
  count: number;
  from: Date;
  to: Date;
  minGapMs: number;
  seedSlots: Date[];
}): Date[] {
  if (params.count <= 0) return [];

  const sortedSeeds = [...params.seedSlots].sort((a, b) => a.getTime() - b.getTime());
  const result: Date[] = [];

  for (const seed of sortedSeeds) {
    if (result.length >= params.count) break;
    if (seed < params.from || seed > params.to) continue;
    const prev = result[result.length - 1];
    const slot = prev && seed.getTime() - prev.getTime() < params.minGapMs
      ? new Date(prev.getTime() + params.minGapMs)
      : seed;
    if (slot <= params.to) result.push(slot);
  }

  let cursor = result.length
    ? new Date(result[result.length - 1].getTime() + params.minGapMs)
    : roundUpTo30Minutes(params.from);

  while (result.length < params.count && cursor <= params.to) {
    result.push(new Date(cursor));
    cursor = new Date(cursor.getTime() + params.minGapMs);
  }

  return result.slice(0, params.count);
}

function buildPartialFirstDayWarmupSlots(params: {
  templateSlots: TimeSlot[];
  postsNeeded: number;
  slotCutoff: Date;
  calendarStart: Date;
  previousScheduled?: Date;
}): { slots: Date[]; skippedPast: string[]; autoGenerated: boolean } {
  const skippedPast: string[] = [];
  const futureTemplate: Date[] = [];

  for (const slot of params.templateSlots) {
    const slotDate = atHourOnDayOffsetInAppTz(
      params.calendarStart,
      0,
      slot.hour,
      slot.minute,
    );
    if (slotDate < params.slotCutoff) {
      skippedPast.push(formatWarmupTimeSlot(slot));
    } else {
      futureTemplate.push(slotDate);
    }
  }

  futureTemplate.sort((a, b) => a.getTime() - b.getTime());
  const endOfDay = atHourOnDayOffsetInAppTz(params.calendarStart, 0, 23, 0);
  const autoGenerated = futureTemplate.length < params.postsNeeded;

  const rawSlots = autoGenerated
    ? generateEvenlySpacedDaySlots({
        count: params.postsNeeded,
        from: params.slotCutoff,
        to: endOfDay,
        minGapMs: PARTIAL_DAY_MIN_GAP_MS,
        seedSlots: futureTemplate,
      })
    : futureTemplate.slice(0, params.postsNeeded);

  let previous = params.previousScheduled;
  const slots = rawSlots.map((slot) => {
    const next = ensureAfterPrevious(slot, previous);
    previous = next;
    return next;
  });

  return { slots, skippedPast, autoGenerated };
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
  /** Recebe avisos sobre horários passados ou slots gerados automaticamente. */
  warnings?: string[];
}) {
  const count = params.count;
  if (count <= 0) return [];

  const warmupDays = clampWarmupDays(params.warmupDays ?? DEFAULT_WARMUP_DAYS);
  const warmupDayOffset = params.warmupDayOffset ?? 0;
  const ramp = buildWarmupRamp(warmupDays);
  const now = params.now ?? new Date();

  const anchorSource =
    params.firstScheduledAt ?? params.startDate ?? resolveStartDate(now);
  const calendar = resolveWarmupCalendarStart({ firstScheduledAt: anchorSource, now });

  const schedule: Date[] = [];
  let calendarDay = 0;
  let warnedPastSlots = false;
  let warnedAutoSlots = false;
  let warnedSplitDays = false;

  while (schedule.length < count) {
    const absoluteWarmupDay = warmupDayOffset + calendarDay;
    const slotTimes = slotsForAbsoluteDay(absoluteWarmupDay, ramp.length);
    const dayCapacity =
      absoluteWarmupDay < ramp.length
        ? (ramp[absoluteWarmupDay] ?? POST_WARMUP_POSTS_PER_DAY)
        : POST_WARMUP_POSTS_PER_DAY;
    const remaining = count - schedule.length;

    if (calendar.partialFirstDay && calendarDay === 0) {
      const postsForToday = Math.min(remaining, dayCapacity);
      const partial = buildPartialFirstDayWarmupSlots({
        templateSlots: slotTimes,
        postsNeeded: postsForToday,
        slotCutoff: calendar.slotCutoff,
        calendarStart: calendar.calendarStart,
        previousScheduled: schedule[schedule.length - 1],
      });

      if (partial.skippedPast.length && params.warnings && !warnedPastSlots) {
        params.warnings.push(
          "Alguns horários de hoje já passaram. O cronograma foi ajustado para os próximos horários disponíveis.",
        );
        for (const time of partial.skippedPast) {
          params.warnings.push(`Horário ignorado: ${time} — já passou`);
        }
        warnedPastSlots = true;
      }

      if (partial.autoGenerated && params.warnings && !warnedAutoSlots) {
        params.warnings.push(
          "Horários intermediários foram gerados automaticamente para caber todos os posts hoje.",
        );
        warnedAutoSlots = true;
      }

      schedule.push(...partial.slots);
      calendarDay++;

      if (remaining > postsForToday && params.warnings && !warnedSplitDays) {
        params.warnings.push(
          `${remaining - postsForToday} publicação(ões) foi(foram) movida(s) para o próximo dia porque a capacidade diária ou os horários disponíveis hoje não comportam todos os vídeos.`,
        );
        warnedSplitDays = true;
      }
      continue;
    }

    for (const { hour, minute } of slotTimes) {
      if (schedule.length >= count) break;

      let scheduled = atHourOnDayOffsetInAppTz(
        calendar.calendarStart,
        calendarDay,
        hour,
        minute,
      );

      if (
        calendar.partialFirstDay &&
        calendarDay === 0 &&
        scheduled < calendar.slotCutoff
      ) {
        continue;
      }

      scheduled = ensureAfterPrevious(scheduled, schedule[schedule.length - 1]);
      schedule.push(scheduled);
    }

    calendarDay++;
  }

  return schedule;
}

/** Gera apenas os slots novos, continuando a sequência do plano (ex.: 10 já agendados → offset 10). */
export function generateWarmupScheduleSlice(params: {
  count: number;
  planSlotOffset?: number;
  warmupDays?: number;
  warmupDayOffset?: number;
  startDate?: Date;
  now?: Date;
  warnings?: string[];
}) {
  const offset = params.planSlotOffset ?? 0;
  const total = offset + params.count;
  const full = generateWarmupSchedule({ ...params, count: total, warnings: params.warnings });
  return full.slice(offset);
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
    label: `${count} vídeo(s) em ~${totalDays} dias (aquecimento ${rampLabel} posts/dia, depois ${POST_WARMUP_POSTS_PER_DAY}/dia)`,
    shortLabel: `~${totalDays} dias (aquecimento ${days}d)`,
  };
}

export function describeWarmupPlan(warmupDays = DEFAULT_WARMUP_DAYS) {
  const ramp = buildWarmupRamp(warmupDays);
  return `Aquecimento ${warmupDays}d: ${ramp.map((n, i) => `D${i + 1}=${n}`).join(", ")} · depois ${POST_WARMUP_POSTS_PER_DAY}/dia`;
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
