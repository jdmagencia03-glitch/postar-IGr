import type { ScheduleJobItemRow } from "@/lib/schedule-jobs/types";

export type CaptionPipelineStatus =
  | "caption_pending"
  | "caption_processing"
  | "caption_done"
  | "caption_failed_retryable"
  | "caption_failed_persistent";

export type HashtagPipelineStatus =
  | "hashtags_pending"
  | "hashtags_done"
  | "hashtags_failed_retryable";

export type ItemPipelineState = {
  caption_status?: CaptionPipelineStatus;
  caption_attempts?: number;
  caption_error?: string | null;
  caption_source?: "ai" | "fallback" | null;
  hashtags_status?: HashtagPipelineStatus;
  hashtags_error?: string | null;
};

export type ItemPipelineCounts = {
  total: number;
  captionDone: number;
  captionPending: number;
  captionFailed: number;
  hashtagsDone: number;
  calendarDone: number;
  calendarPending: number;
  postsSaved: number;
  failed: number;
  pending: number;
};


export function readItemPipeline(item: ScheduleJobItemRow): ItemPipelineState {
  const raw = (item as ScheduleJobItemRow & { pipeline?: ItemPipelineState }).pipeline;
  if (raw && typeof raw === "object") return raw;
  return {};
}

export function deriveCaptionStatus(item: ScheduleJobItemRow): CaptionPipelineStatus {
  const stored = readItemPipeline(item).caption_status;
  if (stored) return stored;

  if (item.caption?.trim()) return "caption_done";
  if (item.status === "failed") return "caption_failed_persistent";
  if (item.status === "retrying" && item.attempt_count > 0) {
    return "caption_failed_retryable";
  }
  if (item.status === "processing" && !item.caption?.trim()) return "caption_processing";
  return "caption_pending";
}

export function deriveHashtagsStatus(item: ScheduleJobItemRow): HashtagPipelineStatus {
  const stored = readItemPipeline(item).hashtags_status;
  if (stored) return stored;

  if (item.hashtags?.trim()) return "hashtags_done";
  if (item.caption?.trim() && /#\w+/.test(item.caption)) return "hashtags_done";
  const captionStatus = deriveCaptionStatus(item);
  if (captionStatus === "caption_done" && !item.hashtags?.trim() && !/#\w+/.test(item.caption ?? "")) {
    return "hashtags_pending";
  }
  if (captionStatus === "caption_done") return "hashtags_done";
  if (captionStatus.startsWith("caption_failed")) return "hashtags_pending";
  return "hashtags_pending";
}

export function isCalendarDone(item: ScheduleJobItemRow): boolean {
  return Boolean(item.destinations?.length);
}

export function isPostSaved(item: ScheduleJobItemRow): boolean {
  return item.status === "completed" && Boolean(item.created_post_id);
}

export function countItemPipeline(items: ScheduleJobItemRow[]): ItemPipelineCounts {
  let captionDone = 0;
  let captionPending = 0;
  let captionFailed = 0;
  let hashtagsDone = 0;
  let calendarDone = 0;
  let calendarPending = 0;
  let postsSaved = 0;
  let failed = 0;

  for (const item of items) {
    const captionStatus = deriveCaptionStatus(item);
    if (captionStatus === "caption_done") captionDone += 1;
    else if (
      captionStatus === "caption_failed_persistent" ||
      captionStatus === "caption_failed_retryable"
    ) {
      captionFailed += 1;
    } else {
      captionPending += 1;
    }

    if (deriveHashtagsStatus(item) === "hashtags_done") hashtagsDone += 1;

    if (isCalendarDone(item)) calendarDone += 1;
    else if (captionStatus === "caption_done") calendarPending += 1;

    if (isPostSaved(item)) postsSaved += 1;
    if (item.status === "failed") failed += 1;
  }

  const total = items.length;
  const pending = Math.max(0, total - postsSaved - failed);

  return {
    total,
    captionDone,
    captionPending,
    captionFailed,
    hashtagsDone,
    calendarDone,
    calendarPending,
    postsSaved,
    failed,
    pending,
  };
}

export function buildPipelinePatch(
  current: ScheduleJobItemRow,
  patch: ItemPipelineState,
): Record<string, unknown> {
  const merged: ItemPipelineState = {
    ...readItemPipeline(current),
    ...patch,
  };
  return { pipeline: merged };
}

export function captionNeedsProcessing(item: ScheduleJobItemRow): boolean {
  if (item.caption?.trim() || item.destinations?.length) return false;
  const status = deriveCaptionStatus(item);
  return status === "caption_pending" || status === "caption_failed_retryable";
}
