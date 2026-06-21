import { ensureFutureScheduleSlot } from "@/lib/smart-schedule";
import { APP_TIMEZONE, atHourOnDayOffsetInAppTz, getAppDateParts } from "@/lib/timezone";

export const ACTIVE_SLOT_STATUSES = ["pending", "processing", "retrying"] as const;

export type SlotOccupant = { id?: string; scheduled_at: string; status?: string };

export function slotDateKey(iso: string) {
  const parts = getAppDateParts(new Date(iso));
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

export function slotTimeLabel(iso: string) {
  const parts = getAppDateParts(new Date(iso));
  return `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;
}

/** Chave única de slot: YYYY-MM-DDTHH:mm em America/Sao_Paulo */
export function slotTimeKey(iso: string) {
  return `${slotDateKey(iso)}T${slotTimeLabel(iso)}`;
}

export function buildSlotOccupancy(existing: SlotOccupant[]) {
  const occupiedTimes = new Set<string>();
  const dayCounts = new Map<string, number>();

  for (const post of existing) {
    const timeKey = slotTimeKey(post.scheduled_at);
    occupiedTimes.add(timeKey);
    const dateKey = slotDateKey(post.scheduled_at);
    dayCounts.set(dateKey, (dayCounts.get(dateKey) ?? 0) + 1);
  }

  return { occupiedTimes, dayCounts };
}

export function isSlotOccupied(
  candidateIso: string,
  occupancy: ReturnType<typeof buildSlotOccupancy>,
  postsPerDay: number,
) {
  const dateKey = slotDateKey(candidateIso);
  const timeKey = slotTimeKey(candidateIso);
  const dayCount = occupancy.dayCounts.get(dateKey) ?? 0;
  return occupancy.occupiedTimes.has(timeKey) || dayCount >= postsPerDay;
}

export function reserveSlot(candidateIso: string, occupancy: ReturnType<typeof buildSlotOccupancy>) {
  const dateKey = slotDateKey(candidateIso);
  occupancy.occupiedTimes.add(slotTimeKey(candidateIso));
  occupancy.dayCounts.set(dateKey, (occupancy.dayCounts.get(dateKey) ?? 0) + 1);
}

export function findNextAvailableSlot(params: {
  existing: SlotOccupant[];
  timeSlots: Array<{ hour: number; minute: number }>;
  postsPerDay: number;
  desiredDate?: Date;
  now?: Date;
  startDayOffset?: number;
  startSlotIndex?: number;
  maxAttempts?: number;
}) {
  const now = params.now ?? new Date();
  const occupancy = buildSlotOccupancy(params.existing);
  const timeSlots = params.timeSlots.length ? params.timeSlots : [{ hour: 19, minute: 0 }];

  let dayOffset = params.startDayOffset ?? 0;
  let slotIndex = params.startSlotIndex ?? 0;

  if (params.desiredDate) {
    const desired = ensureFutureScheduleSlot(params.desiredDate, now);
    const desiredKey = slotTimeKey(desired.toISOString());
    const dateKey = slotDateKey(desired.toISOString());
    const dayCount = occupancy.dayCounts.get(dateKey) ?? 0;

    if (!occupancy.occupiedTimes.has(desiredKey) && dayCount < params.postsPerDay) {
      console.info("[schedule-slot-assigned]", {
        timezone: APP_TIMEZONE,
        desiredTime: desiredKey,
        finalTime: desiredKey,
        moved: false,
      });
      return {
        slot: desired,
        slotIndex,
        dayOffset,
        moved: false,
      };
    }

    const parts = getAppDateParts(desired);
    dayOffset = Math.max(
      0,
      Math.floor(
        (desired.getTime() - atHourOnDayOffsetInAppTz(now, 0, parts.hour, parts.minute).getTime()) /
          86400000,
      ),
    );
    slotIndex = timeSlots.findIndex(
      (slot) => slot.hour === parts.hour && slot.minute === parts.minute,
    );
    if (slotIndex < 0) slotIndex = 0;
    else slotIndex += 1;
  }

  const maxAttempts = params.maxAttempts ?? 500;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const slot = timeSlots[slotIndex % timeSlots.length];
    const candidate = ensureFutureScheduleSlot(
      atHourOnDayOffsetInAppTz(now, dayOffset, slot.hour, slot.minute),
      now,
    );
    const candidateIso = candidate.toISOString();

    if (isSlotOccupied(candidateIso, occupancy, params.postsPerDay)) {
      slotIndex++;
      if (slotIndex % timeSlots.length === 0) dayOffset++;
      continue;
    }

    console.info("[schedule-slot-assigned]", {
      timezone: APP_TIMEZONE,
      desiredTime: params.desiredDate ? slotTimeKey(params.desiredDate.toISOString()) : null,
      finalTime: slotTimeKey(candidateIso),
      moved: Boolean(params.desiredDate),
    });

    return { slot: candidate, slotIndex, dayOffset, moved: Boolean(params.desiredDate) };
  }

  return null;
}

export function detectDuplicateSlots(posts: SlotOccupant[]) {
  const groups = new Map<string, SlotOccupant[]>();

  for (const post of posts) {
    if (post.status && !ACTIVE_SLOT_STATUSES.includes(post.status as (typeof ACTIVE_SLOT_STATUSES)[number])) {
      continue;
    }
    const key = slotTimeKey(post.scheduled_at);
    const bucket = groups.get(key) ?? [];
    bucket.push(post);
    groups.set(key, bucket);
  }

  return [...groups.entries()]
    .filter(([, items]) => items.length > 1)
    .map(([key, items]) => ({
      key,
      scheduledAt: items[0].scheduled_at,
      count: items.length,
      postIds: items.map((item) => item.id).filter(Boolean) as string[],
    }));
}

export function fillScheduleSlots(params: {
  count: number;
  existing: SlotOccupant[];
  timeSlots: Array<{ hour: number; minute: number }>;
  postsPerDay: number;
  now?: Date;
  /** Ancora o primeiro slot (ex.: primeiro post futuro da fila). */
  anchorDate?: Date;
}) {
  const now = params.now ?? new Date();
  const schedule: Date[] = [];
  const virtualExisting = [...params.existing];

  for (let i = 0; i < params.count; i++) {
    const next = findNextAvailableSlot({
      existing: virtualExisting,
      timeSlots: params.timeSlots,
      postsPerDay: params.postsPerDay,
      now,
      desiredDate: i === 0 && params.anchorDate ? params.anchorDate : undefined,
    });
    if (!next) break;

    schedule.push(next.slot);
    virtualExisting.push({ scheduled_at: next.slot.toISOString(), status: "pending" });
  }

  return schedule;
}
