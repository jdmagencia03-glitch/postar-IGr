import { generateBulkCaptions } from "@/lib/ai/captions";
import {
  DEFAULT_WARMUP_DAYS,
  generateWarmupSchedule,
  getWarmupDayOffset,
  groupWarmupScheduleByDay,
} from "@/lib/account-warmup";
import { getOwnerAccountById } from "@/lib/accounts";
import { getOwnerTikTokAccountById } from "@/lib/tiktok/accounts";
import {
  resolveScheduleInsertionPlan,
  type ScheduleInsertionPreview,
  type ScheduleInsertionStrategy,
} from "@/lib/schedule-insertion";
import {
  buildSmartScheduleSlice,
  describeSmartSchedule,
  estimateScheduleDuration,
  resolveAutoPostsPerDay,
  type AutoScheduleOptions,
  type CustomScheduleOptions,
  type ScheduleMode,
  type WarmupScheduleOptions,
} from "@/lib/smart-schedule";
import { contentTypeForPlatform } from "@/lib/content-types";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { InstagramAccount, SocialPlatform, TikTokAccount } from "@/lib/types";

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
  platform: SocialPlatform = "instagram",
): Promise<(InstagramAccount | TikTokAccount)[]> {
  if (platform === "tiktok") {
    const validAccounts: TikTokAccount[] = [];
    for (const accountId of accountIds) {
      const account = await getOwnerTikTokAccountById(supabase, ownerId, accountId);
      if (!account) {
        throw new Error(`Conta TikTok não encontrada: ${accountId}`);
      }
      validAccounts.push(account);
    }
    return validAccounts;
  }

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
  accountId: string;
  schedule_mode?: ScheduleMode;
  batch_offset?: number;
  total_count?: number;
  warmup?: WarmupScheduleOptions;
  custom?: CustomScheduleOptions;
  auto?: AutoScheduleOptions;
  platform?: SocialPlatform;
  campaignContext?: import("@/lib/types").CampaignContext | null;
  supabase?: SupabaseClient;
  upload_batch_id?: string | null;
  schedule_strategy?: ScheduleInsertionStrategy;
  client_batch_scheduled_count?: number;
}) {
  const scheduleMode = params.schedule_mode ?? "auto";
  const totalCount = params.total_count ?? params.items.length;
  const batchOffset = params.batch_offset ?? 0;
  const platform = params.platform ?? "instagram";
  const filenames = params.items.map(
    (item, index) => item.filename ?? `video-${batchOffset + index + 1}.mp4`,
  );

  let schedule: Date[];
  let insertionPreview: ScheduleInsertionPreview | undefined;
  let postsPerDay: number;
  let duration: ReturnType<typeof estimateScheduleDuration>;
  let schedule_summary: string;
  let warmup_breakdown:
    | Array<{ day: number; dateLabel: string; posts: number; times: string[] }>
    | undefined;

  if (params.supabase && params.schedule_strategy) {
    const insertion = await resolveScheduleInsertionPlan({
      supabase: params.supabase,
      platform,
      accountId: params.accountId,
      contentType: contentTypeForPlatform(platform),
      mode: scheduleMode,
      strategy: params.schedule_strategy,
      newVideoCount: totalCount,
      uploadBatchId: params.upload_batch_id,
      clientBatchScheduledCount: params.client_batch_scheduled_count,
      warmup: params.warmup,
      auto: params.auto,
      custom: params.custom,
    });

    schedule = insertion.schedule.slice(batchOffset, batchOffset + params.items.length);
    if (batchOffset === 0) {
      insertionPreview = insertion.preview;
    }

    postsPerDay =
      scheduleMode === "custom"
        ? (params.custom?.postsPerDay ?? 15)
        : scheduleMode === "warmup" || (scheduleMode === "auto" && params.auto?.profile === "new")
          ? 7
          : resolveAutoPostsPerDay(totalCount, params.auto?.profile ?? "growing");

    duration =
      scheduleMode === "warmup"
        ? estimateScheduleDuration(totalCount, "warmup", params.warmup?.warmupDays)
        : scheduleMode === "custom"
          ? estimateScheduleDuration(totalCount, "custom", undefined, params.custom)
          : estimateScheduleDuration(totalCount, "auto", undefined, undefined, params.auto);

    schedule_summary =
      scheduleMode === "warmup"
        ? `Aquecimento 3→3→4→4→7 · ${describeSmartSchedule(insertion.schedule, "auto")}`
        : scheduleMode === "custom"
          ? `${postsPerDay} posts/dia · ${describeSmartSchedule(insertion.schedule, "auto")}`
          : scheduleMode === "auto"
            ? `${postsPerDay} posts/dia · ${describeSmartSchedule(insertion.schedule, "auto")}`
            : describeSmartSchedule(insertion.schedule, scheduleMode);

    warmup_breakdown =
      scheduleMode === "warmup" || scheduleMode === "auto"
        ? groupWarmupScheduleByDay(insertion.schedule)
        : undefined;
  } else {
    const slice = buildSmartScheduleSlice({
      mode: scheduleMode,
      offset: batchOffset,
      count: params.items.length,
      totalCount,
      warmup: params.warmup,
      custom: params.custom,
      auto: params.auto,
    });
    schedule = slice.schedule;
    postsPerDay = slice.postsPerDay;
    duration = slice.duration;
    schedule_summary = slice.schedule_summary;
    warmup_breakdown = slice.warmup_breakdown;
  }

  if (schedule.length < params.items.length) {
    if (scheduleMode === "today") {
      throw new Error(
        `Só há espaço para ${schedule.length} post(s) hoje. Use "Automático" para distribuir em vários dias.`,
      );
    }
    throw new Error("Não foi possível calcular os horários. Tente com menos vídeos.");
  }

  const { captions, source, niche, debug } = await generateBulkCaptions({
    count: params.items.length,
    filenames,
    username: params.username ?? "perfil",
    ownerId: params.ownerId,
    accountId: params.accountId,
    globalOffset: batchOffset,
    niche: params.niche,
    platform: params.platform ?? "instagram",
    contentType: params.platform === "tiktok" ? "tiktok_video" : "reel",
    campaignContext: params.campaignContext,
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
    caption_debug: debug,
    schedule_summary,
    duration,
    schedule: schedule.map((slot) => slot.toISOString()),
    warmup_breakdown,
    preview,
    batch_offset: batchOffset,
    total_count: totalCount,
    warmup: params.warmup,
    insertion_preview: insertionPreview,
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
