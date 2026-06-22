import { randomUUID } from "crypto";
import { generateBulkCaptions } from "@/lib/ai/captions";
import { groupWarmupScheduleByDay, WARMUP_PATTERN } from "@/lib/account-warmup";
import { buildWarmupScheduleSummary } from "@/lib/schedule-plan";
import { contentTypeForPlatform } from "@/lib/content-types";
import {
  TIKTOK_SCHEDULE_OFFSET_MINUTES,
  type MultiplatformVideoPreview,
  type PublishTarget,
} from "@/lib/multiplatform/types";
import {
  buildScheduleWithInsertion,
  type ScheduleInsertionPreview,
  type ScheduleInsertionStrategy,
} from "@/lib/schedule-insertion";
import {
  describeSmartSchedule,
  ensureFutureScheduleSlot,
  estimateScheduleDuration,
  resolveAutoPostsPerDay,
  type AutoScheduleOptions,
  type CustomScheduleOptions,
  type ScheduleMode,
  type WarmupScheduleOptions,
} from "@/lib/smart-schedule";
import type { InstagramAccount, SocialPlatform, TikTokAccount } from "@/lib/types";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface MultiplatformPlanItem {
  media_urls: string[];
  filename?: string;
}

function accountUsername(
  platform: SocialPlatform,
  account: InstagramAccount | TikTokAccount,
): string {
  if (platform === "tiktok") {
    const tt = account as TikTokAccount;
    return tt.username ?? tt.display_name ?? "conta";
  }
  return (account as InstagramAccount).ig_username ?? "conta";
}

function scheduleForPlatform(baseSchedule: Date[], platform: SocialPlatform, now = new Date()) {
  const offsetMs =
    platform === "tiktok" ? TIKTOK_SCHEDULE_OFFSET_MINUTES * 60_000 : 0;

  return baseSchedule.map((slot) =>
    ensureFutureScheduleSlot(new Date(slot.getTime() + offsetMs), now),
  );
}

function buildScheduleMetadata(params: {
  schedule: Date[];
  mode: ScheduleMode;
  totalCount: number;
  warmup?: WarmupScheduleOptions;
  custom?: CustomScheduleOptions;
  auto?: AutoScheduleOptions;
  scheduleSummaryFromPlan?: string;
  skippedPastSlots?: import("@/lib/account-warmup").WarmupSkippedSlot[];
}) {
  const postsPerDay =
    params.mode === "custom"
      ? (params.custom?.postsPerDay ?? 15)
      : params.mode === "warmup" || (params.mode === "auto" && params.auto?.profile === "new")
        ? undefined
        : resolveAutoPostsPerDay(params.totalCount, params.auto?.profile ?? "growing");

  const duration =
    params.mode === "warmup"
      ? estimateScheduleDuration(params.totalCount, "warmup", params.warmup?.warmupDays)
      : params.mode === "custom"
        ? estimateScheduleDuration(params.totalCount, "custom", undefined, params.custom)
        : estimateScheduleDuration(params.totalCount, "auto", undefined, undefined, params.auto);

  const autoProfileLabel =
    params.auto?.profile === "new"
      ? `Conta nova · aquecimento ${WARMUP_PATTERN}`
      : params.auto?.profile === "strong"
        ? `${postsPerDay} posts/dia (conta forte)`
        : params.auto?.profile === "growing"
          ? `${postsPerDay} posts/dia (conta em crescimento)`
          : `${postsPerDay} posts/dia`;

  const schedule_summary =
    params.scheduleSummaryFromPlan ??
    (params.mode === "warmup"
      ? buildWarmupScheduleSummary({
          schedule: params.schedule,
          count: params.totalCount,
          skippedPastSlots: params.skippedPastSlots,
          warmupDays: params.warmup?.warmupDays,
        })
      : params.mode === "custom"
        ? `${postsPerDay} posts/dia · ${describeSmartSchedule(params.schedule, "auto")}`
        : params.mode === "auto"
          ? `${autoProfileLabel} · ${describeSmartSchedule(params.schedule, "auto")}`
          : describeSmartSchedule(params.schedule, params.mode));

  const warmup_breakdown =
    params.mode === "warmup" || (params.mode === "auto" && params.auto?.profile === "new")
      ? groupWarmupScheduleByDay(params.schedule)
      : undefined;

  return { postsPerDay: postsPerDay ?? 0, duration, schedule_summary, warmup_breakdown };
}

export async function buildMultiplatformPlan(params: {
  items: MultiplatformPlanItem[];
  targets: PublishTarget[];
  accounts: Map<string, InstagramAccount | TikTokAccount>;
  ownerId: string;
  schedule_mode?: ScheduleMode;
  batch_offset?: number;
  total_count?: number;
  warmup?: WarmupScheduleOptions;
  custom?: CustomScheduleOptions;
  auto?: AutoScheduleOptions;
  now?: Date;
  campaignContext?: import("@/lib/types").CampaignContext | null;
  supabase?: SupabaseClient;
  upload_batch_id?: string | null;
  schedule_strategy?: ScheduleInsertionStrategy;
  client_batch_scheduled_count?: number;
  insertion_account_id?: string;
  insertion_platform?: SocialPlatform;
}) {
  const scheduleMode = params.schedule_mode ?? "auto";
  const totalCount = params.total_count ?? params.items.length;
  const batchOffset = params.batch_offset ?? 0;
  const now = params.now ?? new Date();

  if (!params.supabase || !params.insertion_account_id || !params.insertion_platform) {
    throw new Error("Contexto de encaixe no calendário é obrigatório para gerar o plano.");
  }

  const insertion = await buildScheduleWithInsertion({
    supabase: params.supabase,
    platform: params.insertion_platform,
    accountId: params.insertion_account_id,
    contentType: contentTypeForPlatform(params.insertion_platform),
    mode: scheduleMode,
    strategy: params.schedule_strategy,
    count: params.items.length,
    batchOffset,
    totalCount,
    uploadBatchId: params.upload_batch_id,
    clientBatchScheduledCount: params.client_batch_scheduled_count,
    warmup: params.warmup,
    auto: params.auto,
    custom: params.custom,
    now,
  });

  const schedule = insertion.schedule;
  const insertionPreview = batchOffset === 0 ? insertion.preview : undefined;

  const meta = buildScheduleMetadata({
    schedule: insertion.totalSchedule,
    mode: scheduleMode,
    totalCount,
    warmup: params.warmup,
    custom: params.custom,
    auto: params.auto,
    scheduleSummaryFromPlan: insertion.scheduleSummary,
    skippedPastSlots: insertion.skippedPastSlots,
  });
  const { postsPerDay, duration, schedule_summary, warmup_breakdown } = meta;

  if (schedule.length < params.items.length) {
    if (scheduleMode === "today") {
      throw new Error(
        `Só há espaço para ${schedule.length} post(s) hoje. Use "Automático" para distribuir em vários dias.`,
      );
    }
    throw new Error("Não foi possível calcular os horários. Tente com menos vídeos.");
  }

  const filenames = params.items.map(
    (item, index) => item.filename ?? `video-${batchOffset + index + 1}.mp4`,
  );

  const captionsByPlatform = new Map<SocialPlatform, { captions: string[]; source: "ai" | "fallback" }>();

  for (const target of params.targets) {
    const account = params.accounts.get(target.account_id);
    if (!account) {
      throw new Error(`Conta não encontrada: ${target.account_id}`);
    }

    const { captions, source } = await generateBulkCaptions({
      count: params.items.length,
      filenames,
      username: accountUsername(target.platform, account),
      ownerId: params.ownerId,
      accountId: target.account_id,
      globalOffset: batchOffset,
      platform: target.platform,
      contentType: contentTypeForPlatform(target.platform),
      campaignContext: params.campaignContext,
    });

    captionsByPlatform.set(target.platform, { captions, source });
  }

  const preview: MultiplatformVideoPreview[] = params.items.map((item, index) => {
    const parent_publish_group_id = randomUUID();
    const groupId = parent_publish_group_id;

    const destinations = params.targets.map((target) => {
      const account = params.accounts.get(target.account_id)!;
      const platformSchedule = scheduleForPlatform(schedule, target.platform, now);
      const captionPack = captionsByPlatform.get(target.platform);

      return {
        platform: target.platform,
        account_id: target.account_id,
        username: accountUsername(target.platform, account),
        caption: captionPack?.captions[index] ?? "",
        scheduled_at: platformSchedule[index].toISOString(),
        content_type: contentTypeForPlatform(target.platform),
      };
    });

    return {
      index: batchOffset + index,
      filename: filenames[index],
      parent_publish_group_id: groupId,
      media_urls: item.media_urls,
      destinations,
    };
  });

  const sources = [...captionsByPlatform.values()].map((pack) => pack.source);
  const caption_source: "ai" | "fallback" = sources.every((s) => s === "ai") ? "ai" : "fallback";

  return {
    preview,
    schedule_mode: scheduleMode,
    posts_per_day: postsPerDay,
    caption_source,
    schedule_summary,
    duration,
    schedule: schedule.map((slot) => slot.toISOString()),
    warmup_breakdown,
    batch_offset: batchOffset,
    total_count: totalCount,
    total_posts: preview.reduce((sum, video) => sum + video.destinations.length, 0),
    insertion_preview: insertionPreview,
  };
}
