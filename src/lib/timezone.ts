/** Horário oficial do app — alinhado ao público BR e ao cron (America/Sao_Paulo). */
export const APP_TIMEZONE = "America/Sao_Paulo";

export type AppDateParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

export function getAppDateParts(date: Date): AppDateParts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: APP_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);

  return {
    year: pick("year"),
    month: pick("month"),
    day: pick("day"),
    hour: pick("hour"),
    minute: pick("minute"),
  };
}

/** Converte horário de parede em São Paulo para instante UTC. */
export function zonedDateTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute = 0,
): Date {
  let guessMs = Date.UTC(year, month - 1, day, hour + 3, minute, 0);

  for (let attempt = 0; attempt < 5; attempt++) {
    const parts = getAppDateParts(new Date(guessMs));
    if (
      parts.year === year &&
      parts.month === month &&
      parts.day === day &&
      parts.hour === hour &&
      parts.minute === minute
    ) {
      return new Date(guessMs);
    }

    const desired = Date.UTC(year, month - 1, day, hour, minute);
    const actual = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
    guessMs += desired - actual;
  }

  return new Date(guessMs);
}

export function atHourInAppTz(base: Date, hour: number, minute = 0): Date {
  const parts = getAppDateParts(base);
  return zonedDateTimeToUtc(parts.year, parts.month, parts.day, hour, minute);
}

export function atHourOnDayOffsetInAppTz(
  base: Date,
  dayOffset: number,
  hour: number,
  minute = 0,
): Date {
  const parts = getAppDateParts(base);
  const rolled = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + dayOffset));
  return zonedDateTimeToUtc(
    rolled.getUTCFullYear(),
    rolled.getUTCMonth() + 1,
    rolled.getUTCDate(),
    hour,
    minute,
  );
}

export function endOfPostingDayInAppTz(base: Date): Date {
  const parts = getAppDateParts(base);
  return zonedDateTimeToUtc(parts.year, parts.month, parts.day, 23, 30);
}

export function formatInAppTimezone(
  date: string | Date,
  options: Intl.DateTimeFormatOptions = { dateStyle: "short", timeStyle: "short" },
): string {
  return new Intl.DateTimeFormat("pt-BR", { ...options, timeZone: APP_TIMEZONE }).format(
    new Date(date),
  );
}

export function toDateTimeLocalInAppTz(iso: string): string {
  const parts = getAppDateParts(new Date(iso));
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`;
}

export function fromDateTimeLocalInAppTz(value: string): string {
  const [datePart, timePart] = value.split("T");
  const [year, month, day] = datePart.split("-").map(Number);
  const [hour, minute] = timePart.split(":").map(Number);
  return zonedDateTimeToUtc(year, month, day, hour, minute).toISOString();
}

export type CreateScheduledAtInput = {
  date: string;
  time: string;
  timezone?: string;
};

/** Converte data + hora de parede (Brasília) para ISO UTC. */
export function createScheduledAtFromBrazilTime(input: CreateScheduledAtInput): string {
  const timezone = input.timezone ?? APP_TIMEZONE;
  if (timezone !== APP_TIMEZONE) {
    console.warn("[schedule-timezone] timezone não suportado, usando APP_TIMEZONE", { timezone });
  }

  const [year, month, day] = input.date.split("-").map(Number);
  const [hour, minute] = input.time.split(":").map(Number);
  const scheduledAtUtc = zonedDateTimeToUtc(year, month, day, hour, minute);

  console.info("[schedule-timezone]", {
    inputDate: input.date,
    inputTime: input.time,
    timezone: APP_TIMEZONE,
    scheduledAtUtc: scheduledAtUtc.toISOString(),
    displayBrazil: formatInAppTimezone(scheduledAtUtc),
  });

  return scheduledAtUtc.toISOString();
}

export function isSameAppDay(iso: string | Date, day: Date): boolean {
  const a = getAppDateParts(new Date(iso));
  const b = getAppDateParts(day);
  return a.year === b.year && a.month === b.month && a.day === b.day;
}
