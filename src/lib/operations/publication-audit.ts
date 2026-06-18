import {
  differenceInMinutes,
  endOfDay,
  format,
  isWithinInterval,
  parseISO,
  startOfDay,
  subDays,
} from "date-fns";
import { ptBR } from "date-fns/locale";
import { CONTENT_TYPE_LABELS } from "@/lib/content-types";
import { getPostAccountUsername } from "@/lib/posts";
import type { ContentType, PostStatus, ScheduledPost, SocialPlatform } from "@/lib/types";

export type AuditPeriod = "today" | "yesterday" | "last_7_days" | "last_30_days";

export type AuditOverallStatus = "ok" | "attention" | "error" | "pending";

export interface AuditDateRange {
  start: Date;
  end: Date;
  label: string;
}

export interface PublicationAuditParams {
  platform?: SocialPlatform | "all";
  contentType?: ContentType | "all";
  accountId?: string;
  auditPeriod?: AuditPeriod;
  auditDate?: string;
}

export interface PublicationAuditSummary {
  scheduled: number;
  published: number;
  failed: number;
  pending: number;
  cancelled: number;
  retrying: number;
  processing: number;
  suspiciousDuplicates: number;
  extraPublished: number;
  missingPublished: number;
  offScheduleCount: number;
  completionRate: number;
  overallStatus: AuditOverallStatus;
  statusMessage: string;
  periodLabel: string;
  accountLabel: string;
}

export interface PublicationAuditRow {
  postId: string;
  scheduledAt: string;
  publishedAt: string | null;
  accountUsername: string;
  accountId: string;
  platform: SocialPlatform;
  contentTypeLabel: string;
  videoLabel: string;
  status: PostStatus;
  scheduleDeltaMinutes: number | null;
  scheduleDeltaLabel: string | null;
  errorMessage: string | null;
  duplicateFlags: string[];
  isDuplicateSuspect: boolean;
  permalink: string | null;
  isPastDue: boolean;
}

export interface PublicationAuditReport {
  summary: PublicationAuditSummary;
  rows: PublicationAuditRow[];
}

const SCHEDULE_TOLERANCE_MINUTES = 30;
const CLOSE_PUBLISH_MINUTES = 15;

function isFailed(status: PostStatus) {
  return status === "failed" || status === "failed_persistent";
}

function isPendingLike(status: PostStatus) {
  return status === "pending" || status === "retrying";
}

function postAccountId(post: ScheduledPost) {
  return (post.platform === "tiktok" ? post.tiktok_account_id : post.account_id) ?? "";
}

function mediaKey(post: ScheduledPost) {
  const url = post.media_urls?.[0] ?? "";
  if (!url) return post.id;
  return url.split("?")[0].toLowerCase();
}

function videoLabel(post: ScheduledPost) {
  const filename = post.media_urls?.[0]?.split("/").pop()?.split("?")[0];
  return filename ?? `Post ${post.id.slice(0, 8)}`;
}

function formatDeltaMinutes(minutes: number) {
  if (minutes === 0) return "No horário";
  const abs = Math.abs(minutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  const text = h > 0 ? `${h}h ${m}min` : `${m} min`;
  return minutes > 0 ? `${text} depois` : `${text} antes`;
}

export function getAuditDateRange(
  auditPeriod: AuditPeriod = "today",
  auditDate?: string,
  now = new Date(),
): AuditDateRange {
  if (auditDate) {
    const day = startOfDay(parseISO(auditDate));
    return {
      start: day,
      end: endOfDay(day),
      label: format(day, "dd/MM/yyyy", { locale: ptBR }),
    };
  }

  switch (auditPeriod) {
    case "yesterday": {
      const day = startOfDay(subDays(now, 1));
      return { start: day, end: endOfDay(day), label: "Ontem" };
    }
    case "last_7_days":
      return {
        start: startOfDay(subDays(now, 6)),
        end: endOfDay(now),
        label: "Últimos 7 dias",
      };
    case "last_30_days":
      return {
        start: startOfDay(subDays(now, 29)),
        end: endOfDay(now),
        label: "Últimos 30 dias",
      };
    case "today":
    default:
      return { start: startOfDay(now), end: endOfDay(now), label: "Hoje" };
  }
}

function inRange(iso: string, range: AuditDateRange) {
  return isWithinInterval(parseISO(iso), { start: range.start, end: range.end });
}

function filterPostsForAudit(posts: ScheduledPost[], params: PublicationAuditParams) {
  return posts.filter((post) => {
    if (params.platform && params.platform !== "all" && (post.platform ?? "instagram") !== params.platform) {
      return false;
    }
    if (params.contentType && params.contentType !== "all") {
      if ((post.content_type ?? "reel") !== params.contentType) return false;
    }
    if (params.accountId && postAccountId(post) !== params.accountId) return false;
    return true;
  });
}

function detectDuplicateFlags(
  post: ScheduledPost,
  publishedInScope: ScheduledPost[],
): string[] {
  const flags: string[] = [];
  if (post.status !== "published" || !post.published_at) return flags;

  const account = postAccountId(post);
  const media = mediaKey(post);
  const publishedDay = format(startOfDay(parseISO(post.published_at)), "yyyy-MM-dd");

  const sameVideoSameDay = publishedInScope.filter(
    (other) =>
      other.id !== post.id &&
      other.status === "published" &&
      other.published_at &&
      postAccountId(other) === account &&
      mediaKey(other) === media &&
      format(startOfDay(parseISO(other.published_at)), "yyyy-MM-dd") === publishedDay,
  );

  if (sameVideoSameDay.length > 0) {
    flags.push("Mesmo vídeo publicado mais de uma vez no dia");
  }

  if (post.media_id) {
    const sameMediaId = publishedInScope.filter(
      (other) =>
        other.id !== post.id &&
        other.status === "published" &&
        other.media_id &&
        other.media_id === post.media_id &&
        postAccountId(other) === account,
    );
    if (sameMediaId.length > 0) {
      flags.push("Mesmo media_id em outra publicação");
    }
  }

  const closePublish = publishedInScope.filter(
    (other) =>
      other.id !== post.id &&
      other.status === "published" &&
      other.published_at &&
      postAccountId(other) === account &&
      mediaKey(other) === media &&
      Math.abs(
        differenceInMinutes(parseISO(other.published_at!), parseISO(post.published_at!)),
      ) <= CLOSE_PUBLISH_MINUTES,
  );
  if (closePublish.length > 0 && !flags.includes("Mesmo vídeo publicado mais de uma vez no dia")) {
    flags.push("Publicações muito próximas do mesmo vídeo");
  }

  if ((post.retry_count ?? 0) > 0 && sameVideoSameDay.length > 0) {
    flags.push("Possível duplicação por retry");
  }

  return flags;
}

function deriveOverallStatus(input: {
  scheduled: number;
  published: number;
  failed: number;
  pending: number;
  processing: number;
  suspiciousDuplicates: number;
  extraPublished: number;
  missingPublished: number;
  hasFuturePending: boolean;
}): { status: AuditOverallStatus; message: string } {
  const {
    scheduled,
    published,
    failed,
    pending,
    processing,
    suspiciousDuplicates,
    extraPublished,
    missingPublished,
    hasFuturePending,
  } = input;

  if (failed > 0 || processing > 0 || suspiciousDuplicates >= 2) {
    const parts: string[] = [];
    if (failed > 0) parts.push(`${failed} falha(s)`);
    if (processing > 0) parts.push(`${processing} preso(s) em publicação`);
    if (suspiciousDuplicates >= 2) parts.push(`${suspiciousDuplicates} duplicados suspeitos`);
    return {
      status: "error",
      message: `Erro — ${parts.join(", ")}`,
    };
  }

  if (hasFuturePending && published < scheduled) {
    return {
      status: "pending",
      message: `Pendente — ${pending} post(s) ainda aguardam publicação no período`,
    };
  }

  if (
    published === scheduled &&
    suspiciousDuplicates === 0 &&
    extraPublished === 0 &&
    missingPublished === 0 &&
    failed === 0
  ) {
    return {
      status: "ok",
      message: "OK — publicou exatamente o programado",
    };
  }

  const parts: string[] = [];
  if (extraPublished > 0) {
    parts.push(`a conta publicou ${extraPublished} vídeo(s) a mais do que o programado`);
  }
  if (missingPublished > 0) {
    parts.push(`${missingPublished} programado(s) não publicado(s)`);
  }
  if (suspiciousDuplicates > 0) {
    parts.push(`${suspiciousDuplicates} duplicado(s) suspeito(s)`);
  }
  if (published !== scheduled && extraPublished === 0 && missingPublished === 0) {
    parts.push(`programados ${scheduled}, publicados ${published}`);
  }

  return {
    status: "attention",
    message: `Atenção — ${parts.join("; ")}`,
  };
}

export function buildPublicationAudit(
  posts: ScheduledPost[],
  params: PublicationAuditParams = {},
  now = new Date(),
): PublicationAuditReport {
  const range = getAuditDateRange(params.auditPeriod ?? "today", params.auditDate, now);
  const scoped = filterPostsForAudit(posts, params);

  const scheduledInPeriod = scoped.filter(
    (post) => post.status !== "cancelled" && inRange(post.scheduled_at, range),
  );

  const publishedInPeriod = scoped.filter(
    (post) => post.status === "published" && post.published_at && inRange(post.published_at, range),
  );

  const publishedOnSchedule = scheduledInPeriod.filter((post) => post.status === "published");

  const extraPublishedPosts = publishedInPeriod.filter(
    (post) => !inRange(post.scheduled_at, range),
  );

  const nowMs = now.getTime();
  const missingPublished = scheduledInPeriod.filter(
    (post) =>
      parseISO(post.scheduled_at).getTime() <= nowMs &&
      post.status !== "published" &&
      post.status !== "cancelled",
  );

  const hasFuturePending = scheduledInPeriod.some(
    (post) =>
      isPendingLike(post.status) && parseISO(post.scheduled_at).getTime() > nowMs,
  );

  const duplicateSuspectIds = new Set<string>();

  const rows: PublicationAuditRow[] = scheduledInPeriod.map((post) => {
    const duplicateFlags = detectDuplicateFlags(post, publishedInPeriod);
    if (duplicateFlags.length > 0) duplicateSuspectIds.add(post.id);

    let scheduleDeltaMinutes: number | null = null;
    let scheduleDeltaLabel: string | null = null;
    if (post.status === "published" && post.published_at) {
      scheduleDeltaMinutes = differenceInMinutes(
        parseISO(post.published_at),
        parseISO(post.scheduled_at),
      );
      scheduleDeltaLabel = formatDeltaMinutes(scheduleDeltaMinutes);
    }

    const isPastDue =
      parseISO(post.scheduled_at).getTime() <= nowMs &&
      isPendingLike(post.status);

    return {
      postId: post.id,
      scheduledAt: post.scheduled_at,
      publishedAt: post.published_at,
      accountUsername: getPostAccountUsername(post),
      accountId: postAccountId(post),
      platform: post.platform ?? "instagram",
      contentTypeLabel:
        CONTENT_TYPE_LABELS[(post.content_type ?? "reel") as ContentType] ??
        post.content_type ??
        "—",
      videoLabel: videoLabel(post),
      status: post.status,
      scheduleDeltaMinutes,
      scheduleDeltaLabel,
      errorMessage: post.error_message,
      duplicateFlags,
      isDuplicateSuspect: duplicateFlags.length > 0,
      permalink: post.permalink,
      isPastDue,
    };
  });

  for (const post of extraPublishedPosts) {
    if (rows.some((row) => row.postId === post.id)) continue;
    const duplicateFlags = detectDuplicateFlags(post, publishedInPeriod);
    if (duplicateFlags.length > 0) duplicateSuspectIds.add(post.id);

    let scheduleDeltaMinutes: number | null = null;
    let scheduleDeltaLabel: string | null = null;
    if (post.published_at) {
      scheduleDeltaMinutes = differenceInMinutes(
        parseISO(post.published_at),
        parseISO(post.scheduled_at),
      );
      scheduleDeltaLabel = formatDeltaMinutes(scheduleDeltaMinutes);
    }

    rows.push({
      postId: post.id,
      scheduledAt: post.scheduled_at,
      publishedAt: post.published_at,
      accountUsername: getPostAccountUsername(post),
      accountId: postAccountId(post),
      platform: post.platform ?? "instagram",
      contentTypeLabel:
        CONTENT_TYPE_LABELS[(post.content_type ?? "reel") as ContentType] ??
        post.content_type ??
        "—",
      videoLabel: videoLabel(post),
      status: post.status,
      scheduleDeltaMinutes,
      scheduleDeltaLabel,
      errorMessage: post.error_message,
      duplicateFlags: [...duplicateFlags, "Publicado fora do período programado"],
      isDuplicateSuspect: true,
      permalink: post.permalink,
      isPastDue: false,
    });
    duplicateSuspectIds.add(post.id);
  }

  rows.sort(
    (a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime(),
  );

  const offScheduleCount = rows.filter(
    (row) =>
      row.scheduleDeltaMinutes !== null &&
      Math.abs(row.scheduleDeltaMinutes) > SCHEDULE_TOLERANCE_MINUTES,
  ).length;

  const scheduled = scheduledInPeriod.length;
  const published = publishedOnSchedule.length;
  const failed = scheduledInPeriod.filter((post) => isFailed(post.status)).length;
  const pending = scheduledInPeriod.filter((post) => isPendingLike(post.status)).length;
  const cancelled = scoped.filter(
    (post) => post.status === "cancelled" && inRange(post.scheduled_at, range),
  ).length;
  const retrying = scheduledInPeriod.filter((post) => post.status === "retrying").length;
  const processing = scheduledInPeriod.filter((post) => post.status === "processing").length;
  const suspiciousDuplicates = duplicateSuspectIds.size;
  const extraPublished = Math.max(0, publishedInPeriod.length - publishedOnSchedule.length);

  const completionRate = scheduled > 0 ? Math.round((published / scheduled) * 100) : 100;

  const accountLabel = params.accountId
    ? `@${rows[0]?.accountUsername ?? "conta"}`
    : "Todas as contas";

  const { status, message } = deriveOverallStatus({
    scheduled,
    published,
    failed,
    pending,
    processing,
    suspiciousDuplicates,
    extraPublished,
    missingPublished: missingPublished.length,
    hasFuturePending,
  });

  return {
    summary: {
      scheduled,
      published,
      failed,
      pending,
      cancelled,
      retrying,
      processing,
      suspiciousDuplicates,
      extraPublished,
      missingPublished: missingPublished.length,
      offScheduleCount,
      completionRate,
      overallStatus: status,
      statusMessage: message,
      periodLabel: range.label,
      accountLabel,
    },
    rows,
  };
}

export function auditStatusClass(status: AuditOverallStatus) {
  switch (status) {
    case "ok":
      return "text-emerald-700 bg-emerald-500/10 border-emerald-500/30";
    case "attention":
      return "text-amber-700 bg-amber-500/10 border-amber-500/30";
    case "error":
      return "text-ig-danger bg-ig-danger/10 border-ig-danger/30";
    default:
      return "text-ig-primary bg-ig-primary/10 border-ig-primary/30";
  }
}

export function auditStatusLabel(status: AuditOverallStatus) {
  switch (status) {
    case "ok":
      return "OK";
    case "attention":
      return "Atenção";
    case "error":
      return "Erro";
    default:
      return "Pendente";
  }
}

export function auditRowsToCsv(rows: PublicationAuditRow[]) {
  const headers = [
    "Agendado",
    "Publicado",
    "Conta",
    "Plataforma",
    "Tipo",
    "Vídeo",
    "Status",
    "Diferença",
    "Erro",
    "Duplicado suspeito",
  ];
  const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const lines = [
    headers.join(","),
    ...rows.map((row) =>
      [
        row.scheduledAt,
        row.publishedAt ?? "",
        row.accountUsername,
        row.platform,
        row.contentTypeLabel,
        row.videoLabel,
        row.status,
        row.scheduleDeltaLabel ?? "",
        row.errorMessage ?? "",
        row.isDuplicateSuspect ? row.duplicateFlags.join("; ") : "",
      ]
        .map(escape)
        .join(","),
    ),
  ];
  return lines.join("\n");
}
