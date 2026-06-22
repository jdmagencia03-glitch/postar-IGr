import type { SupabaseClient } from "@supabase/supabase-js";
import {
  atHourOnDayOffsetInAppTz,
  getAppDateParts,
  zonedDateTimeToUtc,
} from "@/lib/timezone";
import type { ContentType, PostStatus, SocialPlatform } from "@/lib/types";

/**
 * Posts que ocupam capacidade diária do Aquecimento.
 * `failed` = falha temporária/retryable (ainda na fila).
 * Não inclui `failed_persistent`, `cancelled` nem removidos.
 */
export const WARMUP_CAPACITY_STATUSES: PostStatus[] = [
  "published",
  "pending",
  "processing",
  "retrying",
  "failed",
];

/** Explicitamente ignorados na contagem de capacidade do dia. */
export const WARMUP_CAPACITY_EXCLUDED_STATUSES: PostStatus[] = [
  "cancelled",
  "failed_persistent",
  "needs_media",
];

export type WarmupIgnoredStatusCounts = {
  cancelled: number;
  failed_persistent: number;
  needs_media: number;
};

export type WarmupCapacityDaySnapshot = {
  date: string;
  validCount: number;
  cancelledCount: number;
  failedPersistentCount: number;
  needsMediaCount: number;
  limit: number;
  remaining: number;
};

function localDateUtcRange(localDate: string) {
  const [year, month, day] = localDate.split("-").map(Number);
  const start = zonedDateTimeToUtc(year, month, day, 0, 0);
  const end = atHourOnDayOffsetInAppTz(start, 1, 0, 0);
  return { start, end };
}

function localDateKeyFromUtc(date: Date) {
  const parts = getAppDateParts(date);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

/** Lista datas locais consecutivas a partir de YYYY-MM-DD (inclusive). */
export function enumerateLocalDatesFromAnchor(anchorLocalDate: string, dayCount: number): string[] {
  const [year, month, day] = anchorLocalDate.split("-").map(Number);
  const anchor = zonedDateTimeToUtc(year, month, day, 0, 0);
  return Array.from({ length: Math.max(0, dayCount) }, (_, index) =>
    localDateKeyFromUtc(atHourOnDayOffsetInAppTz(anchor, index, 0, 0)),
  );
}

/** Conta posts válidos da conta/plataforma em um dia local (America/Sao_Paulo). */
export async function getExistingValidPostsForLocalDate(
  supabase: SupabaseClient,
  params: {
    accountId: string;
    platform: SocialPlatform;
    localDate: string;
    contentType?: ContentType;
    excludePostIds?: string[];
  },
): Promise<number> {
  const { start, end } = localDateUtcRange(params.localDate);

  let query = supabase
    .from("scheduled_posts")
    .select("id", { count: "exact", head: true })
    .gte("scheduled_at", start.toISOString())
    .lt("scheduled_at", end.toISOString())
    .in("status", WARMUP_CAPACITY_STATUSES);

  if (params.platform === "tiktok") {
    query = query.eq("platform", "tiktok").eq("tiktok_account_id", params.accountId);
  } else {
    query = query.eq("account_id", params.accountId);
  }

  if (params.contentType) {
    query = query.eq("content_type", params.contentType);
  }

  const exclude = params.excludePostIds?.filter(Boolean) ?? [];
  if (exclude.length === 1) {
    query = query.neq("id", exclude[0]!);
  } else if (exclude.length > 1) {
    query = query.not("id", "in", `(${exclude.join(",")})`);
  }

  const { count, error } = await query;
  if (error) throw new Error(error.message);
  return count ?? 0;
}

/** Conta posts ignorados na capacidade (cancelados, failed_persistent, needs_media). */
export async function getIgnoredStatusCountsForLocalDate(
  supabase: SupabaseClient,
  params: {
    accountId: string;
    platform: SocialPlatform;
    localDate: string;
    contentType?: ContentType;
    excludePostIds?: string[];
  },
): Promise<WarmupIgnoredStatusCounts> {
  const { start, end } = localDateUtcRange(params.localDate);
  const result: WarmupIgnoredStatusCounts = {
    cancelled: 0,
    failed_persistent: 0,
    needs_media: 0,
  };

  await Promise.all(
    WARMUP_CAPACITY_EXCLUDED_STATUSES.map(async (status) => {
      let query = supabase
        .from("scheduled_posts")
        .select("id", { count: "exact", head: true })
        .gte("scheduled_at", start.toISOString())
        .lt("scheduled_at", end.toISOString())
        .eq("status", status);

      if (params.platform === "tiktok") {
        query = query.eq("platform", "tiktok").eq("tiktok_account_id", params.accountId);
      } else {
        query = query.eq("account_id", params.accountId);
      }

      if (params.contentType) {
        query = query.eq("content_type", params.contentType);
      }

      const exclude = params.excludePostIds?.filter(Boolean) ?? [];
      if (exclude.length === 1) {
        query = query.neq("id", exclude[0]!);
      } else if (exclude.length > 1) {
        query = query.not("id", "in", `(${exclude.join(",")})`);
      }

      const { count, error } = await query;
      if (error) throw new Error(error.message);

      if (status === "cancelled") result.cancelled = count ?? 0;
      else if (status === "failed_persistent") result.failed_persistent = count ?? 0;
      else if (status === "needs_media") result.needs_media = count ?? 0;
    }),
  );

  return result;
}

export async function buildExistingValidPostsByLocalDate(
  supabase: SupabaseClient,
  params: {
    accountId: string;
    platform: SocialPlatform;
    localDates: string[];
    contentType?: ContentType;
    excludePostIds?: string[];
  },
): Promise<Record<string, number>> {
  const uniqueDates = [...new Set(params.localDates.filter(Boolean))];
  if (!uniqueDates.length) return {};

  if (uniqueDates.length > 3) {
    const sorted = [...uniqueDates].sort();
    const [sy, sm, sd] = sorted[0]!.split("-").map(Number);
    const [ey, em, ed] = sorted[sorted.length - 1]!.split("-").map(Number);
    const dayCount = Math.max(
      1,
      Math.round((Date.UTC(ey, em - 1, ed) - Date.UTC(sy, sm - 1, sd)) / 86_400_000) + 1,
    );
    return buildExistingValidPostsByDateRange(supabase, {
      accountId: params.accountId,
      platform: params.platform,
      contentType: params.contentType,
      startLocalDate: sorted[0]!,
      dayCount,
      excludePostIds: params.excludePostIds,
    });
  }

  const result: Record<string, number> = {};
  await Promise.all(
    uniqueDates.map(async (localDate) => {
      result[localDate] = await getExistingValidPostsForLocalDate(supabase, {
        accountId: params.accountId,
        platform: params.platform,
        localDate,
        contentType: params.contentType,
        excludePostIds: params.excludePostIds,
      });
    }),
  );

  return result;
}

/** Uma query para o intervalo — evita dezenas de round-trips no recálculo. */
export async function buildExistingValidPostsByDateRange(
  supabase: SupabaseClient,
  params: {
    accountId: string;
    platform: SocialPlatform;
    startLocalDate: string;
    dayCount: number;
    contentType?: ContentType;
    excludePostIds?: string[];
  },
): Promise<Record<string, number>> {
  const dates = enumerateLocalDatesFromAnchor(params.startLocalDate, params.dayCount);
  if (!dates.length) return {};

  const rangeStart = localDateUtcRange(dates[0]!).start;
  const lastStart = localDateUtcRange(dates[dates.length - 1]!).start;
  const rangeEnd = atHourOnDayOffsetInAppTz(lastStart, 1, 0, 0);

  let query = supabase
    .from("scheduled_posts")
    .select("id, scheduled_at")
    .gte("scheduled_at", rangeStart.toISOString())
    .lt("scheduled_at", rangeEnd.toISOString())
    .in("status", WARMUP_CAPACITY_STATUSES);

  if (params.platform === "tiktok") {
    query = query.eq("platform", "tiktok").eq("tiktok_account_id", params.accountId);
  } else {
    query = query.eq("account_id", params.accountId);
  }

  if (params.contentType) {
    query = query.eq("content_type", params.contentType);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const exclude = new Set(params.excludePostIds?.filter(Boolean) ?? []);
  const counts = Object.fromEntries(dates.map((date) => [date, 0]));

  for (const post of data ?? []) {
    if (exclude.has(post.id as string)) continue;
    const key = localDateKeyFromUtc(new Date(post.scheduled_at as string));
    if (key in counts) counts[key] = (counts[key] ?? 0) + 1;
  }

  return counts;
}

export async function buildIgnoredStatusCountsByLocalDate(
  supabase: SupabaseClient,
  params: {
    accountId: string;
    platform: SocialPlatform;
    localDates: string[];
    contentType?: ContentType;
    excludePostIds?: string[];
  },
): Promise<Record<string, WarmupIgnoredStatusCounts>> {
  const uniqueDates = [...new Set(params.localDates.filter(Boolean))];
  const result: Record<string, WarmupIgnoredStatusCounts> = {};

  await Promise.all(
    uniqueDates.map(async (localDate) => {
      result[localDate] = await getIgnoredStatusCountsForLocalDate(supabase, {
        accountId: params.accountId,
        platform: params.platform,
        localDate,
        contentType: params.contentType,
        excludePostIds: params.excludePostIds,
      });
    }),
  );

  return result;
}

export async function buildWarmupCapacityDiagnostics(
  supabase: SupabaseClient,
  params: {
    accountId: string;
    platform: SocialPlatform;
    localDates: string[];
    contentType?: ContentType;
    excludePostIds?: string[];
    dailyLimitForRampDay: (rampDayIndex: number) => number;
    warmupStartDate: string;
  },
): Promise<{
  existingValidPostsByDate: WarmupCapacityDaySnapshot[];
  ignoredStatusesByDate: Record<string, Partial<Record<keyof WarmupIgnoredStatusCounts, number>>>;
}> {
  const [validByDate, ignoredByDate] = await Promise.all([
    buildExistingValidPostsByLocalDate(supabase, params),
    buildIgnoredStatusCountsByLocalDate(supabase, params),
  ]);

  const [startYear, startMonth, startDay] = params.warmupStartDate.split("-").map(Number);
  const startUtc = Date.UTC(startYear, startMonth - 1, startDay);

  const existingValidPostsByDate = params.localDates.map((date) => {
    const [year, month, day] = date.split("-").map(Number);
    const dateUtc = Date.UTC(year, month - 1, day);
    const rampDayIndex = Math.max(1, Math.round((dateUtc - startUtc) / 86_400_000) + 1);
    const limit = params.dailyLimitForRampDay(rampDayIndex);
    const validCount = validByDate[date] ?? 0;
    const ignored = ignoredByDate[date] ?? {
      cancelled: 0,
      failed_persistent: 0,
      needs_media: 0,
    };

    return {
      date,
      validCount,
      cancelledCount: ignored.cancelled,
      failedPersistentCount: ignored.failed_persistent,
      needsMediaCount: ignored.needs_media,
      limit,
      remaining: Math.max(0, limit - validCount),
    };
  });

  const ignoredStatusesByDate: Record<string, Partial<Record<keyof WarmupIgnoredStatusCounts, number>>> =
    {};
  for (const entry of existingValidPostsByDate) {
    const ignored: Partial<Record<keyof WarmupIgnoredStatusCounts, number>> = {};
    if (entry.cancelledCount > 0) ignored.cancelled = entry.cancelledCount;
    if (entry.failedPersistentCount > 0) ignored.failed_persistent = entry.failedPersistentCount;
    if (entry.needsMediaCount > 0) ignored.needs_media = entry.needsMediaCount;
    if (Object.keys(ignored).length > 0) {
      ignoredStatusesByDate[entry.date] = ignored;
    }
  }

  return { existingValidPostsByDate, ignoredStatusesByDate };
}
