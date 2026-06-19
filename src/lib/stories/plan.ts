import { generateStoryTexts } from "@/lib/stories/generate-texts";
import type { StoryPreviewEntry } from "@/lib/stories/types";
import {
  buildScheduleWithInsertion,
  type ScheduleInsertionPreview,
  type ScheduleInsertionStrategy,
} from "@/lib/schedule-insertion";
import { parseCustomSchedulePayload, describeSmartSchedule, type ScheduleMode } from "@/lib/smart-schedule";
import { contentTypeForPlatform } from "@/lib/content-types";
import type { SupabaseClient } from "@supabase/supabase-js";

export async function buildStorySchedulePlan(params: {
  items: Array<{ media_url: string; filename?: string }>;
  ownerId: string;
  accountId: string;
  username: string;
  storyObjective: string;
  storyCta: string;
  storyLink?: string | null;
  schedule_mode?: ScheduleMode;
  custom_schedule?: {
    posts_per_day: number;
    time_slots?: string[];
    start_time?: string;
    end_time?: string;
  };
  campaignContext?: import("@/lib/types").CampaignContext | null;
  supabase: SupabaseClient;
  schedule_strategy?: ScheduleInsertionStrategy;
}) {
  const filenames = params.items.map((item, index) => item.filename || `story-${index + 1}`);
  const scheduleMode = params.schedule_mode ?? "auto";
  const customOptions =
    scheduleMode === "custom" && params.custom_schedule
      ? parseCustomSchedulePayload(params.custom_schedule)
      : undefined;

  const insertion = await buildScheduleWithInsertion({
    supabase: params.supabase,
    platform: "instagram",
    accountId: params.accountId,
    contentType: contentTypeForPlatform("instagram"),
    mode: scheduleMode === "warmup" ? "auto" : scheduleMode,
    strategy: params.schedule_strategy,
    count: params.items.length,
    totalCount: params.items.length,
    custom: customOptions,
    auto: scheduleMode === "warmup" ? { profile: "new" } : undefined,
  });

  const { texts, niche, source } = await generateStoryTexts({
    count: params.items.length,
    filenames,
    ownerId: params.ownerId,
    accountId: params.accountId,
    username: params.username,
    storyObjective: params.storyObjective,
    storyCta: params.storyCta,
    storyLink: params.storyLink,
    campaignContext: params.campaignContext,
  });

  const preview: StoryPreviewEntry[] = params.items.map((item, index) => ({
    index,
    filename: filenames[index],
    media_url: item.media_url,
    scheduled_at: insertion.schedule[index].toISOString(),
    story_text: texts[index] ?? "",
    story_cta: params.storyCta,
    story_link: params.storyLink ?? null,
    story_objective: params.storyObjective,
  }));

  return {
    preview,
    schedule: insertion.schedule.map((slot) => slot.toISOString()),
    schedule_summary: `${insertion.preview.summaryLabel} · ${describeSmartSchedule(
      insertion.totalSchedule,
      scheduleMode === "today" ? "today" : "auto",
    )}`,
    insertion_preview: insertion.preview as ScheduleInsertionPreview,
    niche,
    text_source: source,
  };
}
