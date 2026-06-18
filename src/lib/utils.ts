import { atHourOnDayOffsetInAppTz, formatInAppTimezone } from "@/lib/timezone";
export { generateBulkSchedule } from "@/lib/smart-schedule";

export function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export function formatDateTime(date: string | Date) {
  return formatInAppTimezone(date);
}
