import type { SupabaseClient } from "@supabase/supabase-js";
import {
  atHourOnDayOffsetInAppTz,
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

function localDateUtcRange(localDate: string) {
  const [year, month, day] = localDate.split("-").map(Number);
  const start = zonedDateTimeToUtc(year, month, day, 0, 0);
  const end = atHourOnDayOffsetInAppTz(start, 1, 0, 0);
  return { start, end };
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

export async function buildExistingValidPostsByLocalDate(
  supabase: SupabaseClient,
  params: {
    accountId: string;
    platform: SocialPlatform;
    localDates: string[];
    contentType?: ContentType;
  },
): Promise<Record<string, number>> {
  const uniqueDates = [...new Set(params.localDates.filter(Boolean))];
  const result: Record<string, number> = {};

  await Promise.all(
    uniqueDates.map(async (localDate) => {
      result[localDate] = await getExistingValidPostsForLocalDate(supabase, {
        accountId: params.accountId,
        platform: params.platform,
        localDate,
        contentType: params.contentType,
      });
    }),
  );

  return result;
}
