import { addDays, setHours, setMinutes, setSeconds } from "date-fns";

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
    const day = addDays(startDate, dayOffset);
    const scheduled = setSeconds(setMinutes(setHours(day, hour), 0), 0);
    schedule.push(scheduled);

    slot++;
    if (slot % postsPerDay === 0) {
      dayOffset++;
      slot = 0;
    }
  }

  return schedule;
}

export function formatDateTime(date: string | Date) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(date));
}
