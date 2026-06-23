import {
  differenceInCalendarDays,
  differenceInHours,
  format,
  parseISO,
  startOfDay,
  startOfMonth,
  endOfMonth,
  eachMonthOfInterval,
  isWithinInterval,
  getDay,
} from "date-fns";
import { ptBR } from "date-fns/locale";
import { formatInAppTimezone, getAppDateParts } from "@/lib/timezone";
import type { ScheduledPost } from "@/lib/types";

const DAY_NAMES = ["Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"];

export function extractHashtags(caption: string | null) {
  if (!caption) return [];
  return caption.match(/#[\w\u00C0-\u017F]+/g) ?? [];
}

export function formatShortDate(date: string | Date) {
  return formatInAppTimezone(date, { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function formatShortDateTime(date: string | Date) {
  return formatInAppTimezone(date, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).replace(",", " •");
}

export function formatDuration(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (!hours) return `${mins}min`;
  return `${hours}h ${mins.toString().padStart(2, "0")}min`;
}

function pendingPosts(posts: ScheduledPost[]) {
  return posts.filter(
    (post) =>
      post.status === "pending" ||
      post.status === "processing" ||
      post.status === "retrying",
  );
}

function publishedPosts(posts: ScheduledPost[]) {
  return posts.filter((post) => post.status === "published" && post.published_at);
}

export function getLastPublishedAt(posts: ScheduledPost[]) {
  const last = publishedPosts(posts).sort(
    (a, b) => new Date(b.published_at!).getTime() - new Date(a.published_at!).getTime(),
  )[0];
  return last?.published_at ?? null;
}

export function computeCoverageDays(posts: ScheduledPost[], now = new Date()) {
  const pending = pendingPosts(posts);
  if (!pending.length) return 0;

  const last = pending.reduce((max, post) => {
    const time = new Date(post.scheduled_at).getTime();
    return time > max ? time : max;
  }, 0);

  return Math.max(0, differenceInCalendarDays(new Date(last), startOfDay(now)));
}

export function computeNextPost(posts: ScheduledPost[]) {
  const pending = pendingPosts(posts)
    .filter((post) => post.status === "pending")
    .sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime());

  return pending[0] ?? null;
}

export function computeLastScheduled(posts: ScheduledPost[]) {
  const pending = pendingPosts(posts);
  if (!pending.length) return null;

  return pending.reduce((latest, post) =>
    new Date(post.scheduled_at) > new Date(latest.scheduled_at) ? post : latest,
  );
}

export function computePublishingStreak(posts: ScheduledPost[]) {
  const days = new Set(
    publishedPosts(posts).map((post) => format(startOfDay(parseISO(post.published_at!)), "yyyy-MM-dd")),
  );

  if (!days.size) return { current: 0, best: 0 };

  const sortedDays = [...days].sort();
  let best = 1;
  let streak = 1;

  for (let i = 1; i < sortedDays.length; i++) {
    const prev = new Date(sortedDays[i - 1]);
    const curr = new Date(sortedDays[i]);
    if (differenceInCalendarDays(curr, prev) === 1) {
      streak++;
      best = Math.max(best, streak);
    } else {
      streak = 1;
    }
  }

  let current = 0;
  const today = startOfDay(new Date());
  let cursor = today;

  while (days.has(format(cursor, "yyyy-MM-dd"))) {
    current++;
    cursor = new Date(cursor.getTime() - 86400000);
  }

  return { current, best };
}

export function computeTimeSavedMinutes(postCount: number) {
  return postCount * 13;
}

export function computeAccountScore(params: {
  coverageDays: number;
  streak: number;
  failedCount: number;
  pendingCount: number;
}) {
  const frequency = Math.min(100, Math.round((params.pendingCount / 30) * 100));
  const consistency = Math.min(100, Math.round((params.streak / 30) * 100));
  const queue = Math.min(100, Math.round((params.coverageDays / 60) * 100));
  const penalty = params.failedCount * 8;
  const score = Math.max(0, Math.min(100, Math.round((frequency + consistency + queue) / 3 - penalty)));

  return {
    score,
    frequency: frequency >= 70 ? "Excelente" : frequency >= 40 ? "Boa" : "Regular",
    consistency: consistency >= 70 ? "Excelente" : consistency >= 40 ? "Boa" : "Regular",
    queue: queue >= 70 ? "Excelente" : queue >= 40 ? "Boa" : "Regular",
  };
}

export function computeHealthChecks(params: {
  tokenValid: boolean;
  pendingCount: number;
  failedCount: number;
  retryingCount?: number;
  duplicateSlotCount?: number;
  playbookConfigured?: boolean;
  health?: "healthy" | "attention" | "error";
}) {
  const checks = [
    { label: "Token válido", ok: params.tokenValid },
    {
      label: "Publicação ativa",
      ok: params.tokenValid && (params.retryingCount ?? 0) === 0,
    },
    { label: "Fila abastecida", ok: params.pendingCount > 0 },
    {
      label: "Sem falhas críticas",
      ok:
        params.failedCount === 0 &&
        (params.duplicateSlotCount ?? 0) === 0 &&
        params.health !== "error",
    },
  ];

  if (params.playbookConfigured === false) {
    checks.push({ label: "Playbook configurado", ok: false });
  }

  const percent = Math.round((checks.filter((item) => item.ok).length / checks.length) * 100);
  return { checks, percent };
}

export function computeMonthlyCoverage(posts: ScheduledPost[], now = new Date()) {
  const pending = pendingPosts(posts);
  if (!pending.length) return { months: [], until: null as string | null };

  const first = pending.reduce((min, post) =>
    new Date(post.scheduled_at) < new Date(min.scheduled_at) ? post : min,
  );
  const last = computeLastScheduled(posts)!;

  const months = eachMonthOfInterval({
    start: startOfMonth(parseISO(first.scheduled_at)),
    end: endOfMonth(parseISO(last.scheduled_at)),
  }).slice(0, 6);

  const monthRows = months.map((monthStart) => {
    const monthEnd = endOfMonth(monthStart);
    const count = pending.filter((post) =>
      isWithinInterval(parseISO(post.scheduled_at), { start: monthStart, end: monthEnd }),
    ).length;
    const fill = Math.min(100, Math.round((count / 30) * 100));

    return {
      label: format(monthStart, "MMM", { locale: ptBR }).toUpperCase(),
      fill,
      count,
    };
  });

  return {
    months: monthRows,
    until: formatShortDate(last.scheduled_at),
  };
}

export function computeScheduleInsights(posts: ScheduledPost[]) {
  const published = publishedPosts(posts);
  if (published.length < 5) {
    return {
      bestHour: null as string | null,
      bestDay: null as string | null,
      hasEnoughData: false,
    };
  }

  const hourCounts = new Map<number, number>();
  const dayCounts = new Map<string, number>();

  for (const post of published) {
    const parts = getAppDateParts(parseISO(post.published_at!));
    hourCounts.set(parts.hour, (hourCounts.get(parts.hour) ?? 0) + 1);
    const dayLabel = formatInAppTimezone(post.published_at!, { weekday: "long" });
    dayCounts.set(dayLabel, (dayCounts.get(dayLabel) ?? 0) + 1);
  }

  const bestHourEntry = [...hourCounts.entries()].sort((a, b) => b[1] - a[1])[0];
  const bestDayEntry = [...dayCounts.entries()].sort((a, b) => b[1] - a[1])[0];

  return {
    bestHour: bestHourEntry
      ? `${String(bestHourEntry[0]).padStart(2, "0")}:00`
      : null,
    bestDay: bestDayEntry ? bestDayEntry[0] : null,
    hasEnoughData: true,
  };
}

export function computeAlerts(params: {
  coverageDays: number;
  failedCount: number;
  tokenValid: boolean;
}) {
  const alerts: Array<{ id: string; tone: "warning" | "danger"; title: string; message: string; actionHref?: string; actionLabel?: string }> = [];

  if (params.coverageDays <= 5) {
    alerts.push({
      id: "low-queue",
      tone: "warning",
      title: "Conteúdo acabando",
      message: `Restam apenas ${params.coverageDays} dia(s) de conteúdo programado.`,
      actionHref: "/dashboard/bulk",
      actionLabel: "Agendar mais vídeos",
    });
  }

  if (!params.tokenValid) {
    alerts.push({
      id: "token",
      tone: "warning",
      title: "Token próximo do vencimento",
      message: "Renove para evitar interrupções.",
      actionHref: "/api/auth/meta?next=/dashboard/reports",
      actionLabel: "Reconectar conta",
    });
  }

  if (params.failedCount > 0) {
    alerts.push({
      id: "failed",
      tone: "danger",
      title: "Publicação falhou",
      message: `${params.failedCount} post(s) precisa(m) de atenção.`,
      actionHref: "/dashboard/reports?status=failed",
      actionLabel: "Ver falhas",
    });
  }

  return alerts;
}

export function filterPostsByPeriod(posts: ScheduledPost[], period?: string, now = new Date()) {
  if (!period || period === "all") return posts;

  const start = startOfDay(now);
  const end = new Date(start);

  if (period === "today") {
    end.setHours(23, 59, 59, 999);
  } else if (period === "tomorrow") {
    start.setDate(start.getDate() + 1);
    end.setDate(end.getDate() + 1);
    end.setHours(23, 59, 59, 999);
  } else if (period === "week") {
    end.setDate(end.getDate() + 7);
  } else if (period === "month") {
    end.setMonth(end.getMonth() + 1);
  } else {
    return posts;
  }

  return posts.filter((post) => {
    const date = parseISO(post.scheduled_at);
    return isWithinInterval(date, { start, end });
  });
}

export function hoursUntilNextPost(nextPost: ScheduledPost | null) {
  if (!nextPost) return null;
  return Math.max(0, differenceInHours(parseISO(nextPost.scheduled_at), new Date()));
}

export function computeOperationsSnapshot(posts: ScheduledPost[]) {
  const pendingCount = posts.filter(
    (post) => post.status === "pending" || post.status === "retrying",
  ).length;
  const failedCount = posts.filter(
    (post) => post.status === "failed" || post.status === "failed_persistent",
  ).length;
  const publishedCount = posts.filter((post) => post.status === "published").length;
  const scheduledCount = posts.filter(
    (post) => post.status === "pending" || post.status === "processing" || post.status === "published",
  ).length;

  const coverageDays = computeCoverageDays(posts);
  const nextPost = computeNextPost(posts);
  const lastScheduled = computeLastScheduled(posts);
  const streak = computePublishingStreak(posts);
  const timeSavedMinutes = computeTimeSavedMinutes(scheduledCount);
  const accountScore = computeAccountScore({
    coverageDays,
    streak: streak.current,
    failedCount,
    pendingCount,
  });
  const monthlyCoverage = computeMonthlyCoverage(posts);
  const scheduleInsights = computeScheduleInsights(posts);

  return {
    pendingCount,
    failedCount,
    publishedCount,
    scheduledCount,
    coverageDays,
    nextPost,
    lastScheduled,
    streak,
    timeSavedMinutes,
    accountScore,
    monthlyCoverage,
    scheduleInsights,
  };
}
