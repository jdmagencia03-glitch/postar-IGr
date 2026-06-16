import { atHourOnDayOffsetInAppTz, formatInAppTimezone } from "@/lib/timezone";

export function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export function generateBulkSchedule(params: {
  count: number;
  startDate: Date;
  postsPerDay: number;
  hours: number[];
}): Date[] {
  const { count, startDate, postsPerDay, hours } = params;
  const schedule: Date[] = [];
  let dayOffset = 0;
  let slot = 0;

  for (let i = 0; i < count; i++) {
    const hour = hours[slot % hours.length];
    schedule.push(atHourOnDayOffsetInAppTz(startDate, dayOffset, hour, 0));

    slot++;
    if (slot % postsPerDay === 0) {
      dayOffset++;
      slot = 0;
    }
  }

  return schedule;
}

export function formatDateTime(date: string | Date) {
  return formatInAppTimezone(date);
}
