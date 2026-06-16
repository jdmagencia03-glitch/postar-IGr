import { generateBulkCaptions } from "@/lib/ai/captions";
import {
  DEFAULT_WARMUP_DAYS,
  generateWarmupSchedule,
  getWarmupDayOffset,
} from "@/lib/account-warmup";
import { getOwnerAccountById } from "@/lib/accounts";
import { buildSmartScheduleSlice, type CustomScheduleOptions, type ScheduleMode, type WarmupScheduleOptions } from "@/lib/smart-schedule";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { InstagramAccount } from "@/lib/types";

export interface AutopilotItem {
  media_urls: string[];
  filename?: string;
}

export interface AutopilotPreviewEntry {
  index: number;
  filename: string;
  scheduled_at: string;
  caption: string;
}

export async function resolveAutopilotAccounts(
  supabase: SupabaseClient,
  ownerId: string,
  accountIds: string[],
) {
  const validAccounts: InstagramAccount[] = [];

  for (const accountId of accountIds) {
    const account = await getOwnerAccountById(supabase, ownerId, accountId);
    if (!account) {
      throw new Error(`Conta não encontrada: ${accountId}`);
    }
    validAccounts.push(account);
  }

  return validAccounts;
}

export async function buildAutopilotPlan(params: {
  items: AutopilotItem[];
  niche?: string;
  username?: string;
  ownerId: string;
  schedule_mode?: ScheduleMode;
  batch_offset?: number;
  total_count?: number;
  warmup?: WarmupScheduleOptions;
  custom?: CustomScheduleOptions;
}) {
  const niche = params.niche?.trim() || "fitness e lifestyle";
  const scheduleMode = params.schedule_mode ?? "auto";
  const totalCount = params.total_count ?? params.items.length;
  const batchOffset = params.batch_offset ?? 0;
  const filenames = params.items.map(
    (item, index) => item.filename ?? `video-${batchOffset + index + 1}.mp4`,
  );

  const { schedule, postsPerDay, duration, schedule_summary } = buildSmartScheduleSlice({
    mode: scheduleMode,
    offset: batchOffset,
    count: params.items.length,
    totalCount,
    warmup: params.warmup,
    custom: params.custom,
  });

  const { captions, source } = await generateBulkCaptions({
    count: params.items.length,
    filenames,
    niche,
    username: params.username ?? "perfil",
    ownerId: params.ownerId,
    globalOffset: batchOffset,
  });

  const preview: AutopilotPreviewEntry[] = params.items.map((item, index) => ({
    index: batchOffset + index,
    filename: filenames[index],
    scheduled_at: schedule[index].toISOString(),
    caption: captions[index] ?? "",
  }));

  return {
    niche,
    schedule_mode: scheduleMode,
    posts_per_day: postsPerDay,
    caption_source: source,
    schedule_summary,
    duration,
    schedule: schedule.map((slot) => slot.toISOString()),
    preview,
    batch_offset: batchOffset,
    total_count: totalCount,
    warmup: params.warmup,
  };
}

export function buildAccountWarmupSchedule(
  account: InstagramAccount,
  videoCount: number,
  now = new Date(),
) {
  const warmupDays = account.warmup_days ?? DEFAULT_WARMUP_DAYS;
  const offset = getWarmupDayOffset(account.warmup_started_at ?? account.created_at, now);

  return generateWarmupSchedule({
    count: videoCount,
    warmupDays,
    warmupDayOffset: offset,
    now,
  });
}

export function resolveScheduleForAccount(params: {
  account: InstagramAccount;
  videoCount: number;
  scheduleMode: ScheduleMode;
  now?: Date;
}) {
  if (params.scheduleMode === "warmup") {
    return buildAccountWarmupSchedule(params.account, params.videoCount, params.now);
  }

  const { schedule } = buildSmartScheduleSlice({
    mode: params.scheduleMode,
    offset: 0,
    count: params.videoCount,
    totalCount: params.videoCount,
  });

  return schedule;
}
