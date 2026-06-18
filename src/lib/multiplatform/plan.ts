import { randomUUID } from "crypto";
import { generateBulkCaptions } from "@/lib/ai/captions";
import { contentTypeForPlatform } from "@/lib/content-types";
import {
  TIKTOK_SCHEDULE_OFFSET_MINUTES,
  type MultiplatformVideoPreview,
  type PublishTarget,
} from "@/lib/multiplatform/types";
import {
  buildSmartScheduleSlice,
  ensureFutureScheduleSlot,
  type CustomScheduleOptions,
  type ScheduleMode,
  type WarmupScheduleOptions,
} from "@/lib/smart-schedule";
import type { InstagramAccount, SocialPlatform, TikTokAccount } from "@/lib/types";

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
  now?: Date;
}) {
  const scheduleMode = params.schedule_mode ?? "auto";
  const totalCount = params.total_count ?? params.items.length;
  const batchOffset = params.batch_offset ?? 0;
  const now = params.now ?? new Date();

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
    now,
  });

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
    batch_offset: batchOffset,
    total_count: totalCount,
    total_posts: preview.reduce((sum, video) => sum + video.destinations.length, 0),
  };
}
