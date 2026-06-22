import {
  WARMUP_PATTERN,
  buildWarmupSchedulePlan,
  formatWarmupTimeSlot,
  getWarmupSlotsForDay,
  resolveWarmupScheduleContext,
  type WarmupPlannedPost,
  type WarmupSchedulePlanResult,
  type WarmupSkippedSlot,
} from "@/lib/account-warmup";
import { describeScheduleDaySpan } from "@/lib/smart-schedule";
import { getAppDateParts } from "@/lib/timezone";

export type SchedulePlanMode = "warmup" | "auto" | "today" | "custom";

export type PlannedPost = WarmupPlannedPost;
export type SkippedPastSlot = WarmupSkippedSlot;

export type SchedulePlanResult = {
  schedule: Date[];
  scheduleMode: SchedulePlanMode;
  warmupPattern: string | null;
  skippedPastSlots: SkippedPastSlot[];
  plannedPosts: PlannedPost[];
  warnings: string[];
  scheduleSummary: string;
};

export { getWarmupSlotsForDay, WARMUP_PATTERN };

function formatSkippedPastWarning(skipped: SkippedPastSlot[]) {
  if (!skipped.length) return null;
  const byDate = new Map<string, string[]>();
  for (const slot of skipped) {
    const list = byDate.get(slot.date) ?? [];
    list.push(slot.time);
    byDate.set(slot.date, list);
  }
  const parts = [...byDate.entries()].map(([date, times]) => {
    const [y, m, d] = date.split("-");
    const label = `${d}/${m}/${y}`;
    return `${times.length} horário(s) de ${label}: ${times.join(", ")}`;
  });
  return `${skipped.length} horário(s) ignorado(s) porque já passaram — ${parts.join("; ")}.`;
}

export function buildWarmupScheduleSummary(params: {
  schedule: Date[];
  count: number;
  skippedPastSlots?: SkippedPastSlot[];
  warmupDays?: number;
}) {
  const pattern = WARMUP_PATTERN;
  const range = describeScheduleDaySpan(params.schedule);
  const summary = `Aquecimento ${pattern} · ${params.count} posts em ${range}`;

  const skipWarning = formatSkippedPastWarning(params.skippedPastSlots ?? []);
  return skipWarning ? `${summary}\n${skipWarning}` : summary;
}

/** Corrige summaries legados com contagem duplicada ("50 posts em 50 posts em"). */
export function normalizeWarmupScheduleSummary(summary: string | null | undefined) {
  if (!summary) return summary ?? null;
  return summary.replace(/(\d+)\s+posts em \1\s+posts em /gi, "$1 posts em ");
}

/** Fonte única para preview, apply, job e diagnóstico (modo warmup). */
export function buildSchedulePlan(params: {
  mode: SchedulePlanMode;
  count: number;
  warmupDays?: number;
  strategy?: "continue" | "new_plan" | "fill_gaps";
  anchorStartDate?: Date;
  firstScheduledAt?: Date;
  now?: Date;
}): SchedulePlanResult {
  if (params.mode !== "warmup") {
    throw new Error("buildSchedulePlan: apenas modo warmup nesta versão");
  }

  const now = params.now ?? new Date();
  const warmupContext = resolveWarmupScheduleContext({
    strategy: params.strategy ?? "new_plan",
    anchorStartDate: params.anchorStartDate ?? params.firstScheduledAt,
    now,
  });

  const plan = buildWarmupSchedulePlan({
    count: params.count,
    warmupDays: params.warmupDays,
    warmupDayOffset: warmupContext.warmupDayOffset,
    firstScheduledAt: warmupContext.firstScheduledAt,
    now,
  });

  const scheduleSummary = buildWarmupScheduleSummary({
    schedule: plan.schedule,
    count: params.count,
    skippedPastSlots: plan.skippedPastSlots,
    warmupDays: params.warmupDays,
  });

  return {
    schedule: plan.schedule,
    scheduleMode: "warmup",
    warmupPattern: WARMUP_PATTERN,
    skippedPastSlots: plan.skippedPastSlots,
    plannedPosts: plan.plannedPosts,
    warnings: plan.warnings,
    scheduleSummary,
  };
}

export function plannedPostsFromSchedule(
  schedule: Date[],
  slotSource: PlannedPost["slotSource"] = "warmup_fixed",
): PlannedPost[] {
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
      slotSource,
    };
  });
}

export function mergeSchedulePlanWarnings(
  plan: Pick<SchedulePlanResult, "warnings" | "skippedPastSlots">,
): string[] {
  const warnings = [...plan.warnings];
  const skipWarning = formatSkippedPastWarning(plan.skippedPastSlots);
  if (skipWarning && !warnings.some((w) => w.includes("ignorado"))) {
    warnings.push(skipWarning);
  }
  return warnings;
}

export type { WarmupSchedulePlanResult };
