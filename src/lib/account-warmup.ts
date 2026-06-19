import {
  atHourInAppTz,
  atHourOnDayOffsetInAppTz,
  getAppDateParts,
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

const BUFFER_MINUTES = 15;

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
    times: WARMUP_DAY_TIME_SLOTS[index].slice(0, posts).map(formatWarmupTimeSlot),
  }));
}

function slotsForAbsoluteDay(absoluteDay: number, rampLength: number): TimeSlot[] {
  if (absoluteDay < rampLength) {
    const postsToday = buildWarmupRamp(rampLength)[absoluteDay] ?? 0;
    return [...WARMUP_DAY_TIME_SLOTS[absoluteDay]].slice(0, postsToday);
  }
  return [...POST_WARMUP_TIME_SLOTS];
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

export function generateWarmupSchedule(params: {
  count: number;
  warmupDays?: number;
  warmupDayOffset?: number;
  /** Ancora o Dia 1 do plano (continuação de lote/calendário). */
  startDate?: Date;
  now?: Date;
}) {
  const count = params.count;
  if (count <= 0) return [];

  const warmupDays = clampWarmupDays(params.warmupDays ?? DEFAULT_WARMUP_DAYS);
  const warmupDayOffset = params.warmupDayOffset ?? 0;
  const ramp = buildWarmupRamp(warmupDays);
  const startDate = params.startDate ?? resolveStartDate(params.now);

  const schedule: Date[] = [];
  let calendarDay = 0;

  while (schedule.length < count) {
    const absoluteWarmupDay = warmupDayOffset + calendarDay;
    const slotTimes = slotsForAbsoluteDay(absoluteWarmupDay, ramp.length);

    for (const { hour, minute } of slotTimes) {
      if (schedule.length >= count) break;

      let scheduled = atHourOnDayOffsetInAppTz(startDate, calendarDay, hour, minute);
      if (scheduled < startDate) continue;

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
}) {
  const offset = params.planSlotOffset ?? 0;
  const total = offset + params.count;
  const full = generateWarmupSchedule({ ...params, count: total });
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
