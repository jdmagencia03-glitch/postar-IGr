import { buildSmartScheduleSlice, parseCustomSchedulePayload, type ScheduleMode } from "@/lib/smart-schedule";
import { generateStoryTexts } from "@/lib/stories/generate-texts";
import type { StoryPreviewEntry } from "@/lib/stories/types";

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
}) {
  const filenames = params.items.map((item, index) => item.filename || `story-${index + 1}`);
  const customOptions =
    params.schedule_mode === "custom" && params.custom_schedule
      ? parseCustomSchedulePayload(params.custom_schedule)
      : undefined;

  const { schedule, schedule_summary } = buildSmartScheduleSlice({
    mode: params.schedule_mode ?? "auto",
    offset: 0,
    count: params.items.length,
    totalCount: params.items.length,
    custom: customOptions,
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
  });

  const preview: StoryPreviewEntry[] = params.items.map((item, index) => ({
    index,
    filename: filenames[index],
    media_url: item.media_url,
    scheduled_at: schedule[index].toISOString(),
    story_text: texts[index] ?? "",
    story_cta: params.storyCta,
    story_link: params.storyLink ?? null,
    story_objective: params.storyObjective,
  }));

  return {
    preview,
    schedule: schedule.map((slot) => slot.toISOString()),
    schedule_summary,
    niche,
    text_source: source,
  };
}
