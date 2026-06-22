import type { SocialPlatform } from "@/lib/types";
import type { PublishTarget } from "@/lib/multiplatform/types";
import type { ScheduleInsertionStrategy } from "@/lib/schedule-insertion";

export type ScheduleJobStatus =
  | "queued"
  | "processing"
  | "completed"
  | "partial_failed"
  | "failed"
  | "cancelled";

export type ScheduleJobStep = "queued" | "planning" | "captions" | "inserting" | "completed";

export type ScheduleJobItemStatus = "queued" | "processing" | "completed" | "failed" | "retrying";

export type ScheduleJobDestination = {
  platform: SocialPlatform;
  account_id: string;
  caption: string;
  scheduled_at: string;
  created_post_id?: string | null;
};

export type ScheduleJobScheduleMode = "auto" | "warmup" | "today" | "custom";

export type ScheduleJobConfig = {
  targets: PublishTarget[];
  schedule_mode: ScheduleJobScheduleMode;
  custom_schedule?: {
    posts_per_day: number;
    time_slots?: string[];
    start_time?: string;
    end_time?: string;
  };
  schedule_strategy?: ScheduleInsertionStrategy;
  batch_scheduled_count?: number;
  product_id?: string | null;
  campaign_id?: string | null;
  content_objective?: string | null;
  auto_profile?: "new" | "growing" | "strong";
  niche?: string;
  schedule_plan?: {
    warmupPattern?: string | null;
    warmupStartDate?: string | null;
    timezone?: string | null;
    nowUsedForPlanning?: string | null;
    skippedPastSlots?: Array<{ date: string; time: string; reason: "past_time" }>;
    plannedPosts?: Array<{
      dayIndex: number;
      scheduledAt: string;
      slot: string;
      slotSource: "warmup_fixed";
    }>;
    planningMeta?: {
      existingValidPostsToday: number;
      remainingSlotsToday: number;
      warmupStartDate: string;
      effectiveFirstScheduledDate: string | null;
      timezone: string;
    } | null;
  };
};

export type ScheduleJobRow = {
  id: string;
  owner_id: string;
  account_id: string | null;
  tiktok_account_id: string | null;
  upload_batch_id: string | null;
  mode: string;
  platform: string;
  content_type: string;
  schedule_mode: string;
  total_items: number;
  processed_items: number;
  completed_items: number;
  failed_items: number;
  status: ScheduleJobStatus;
  current_step: ScheduleJobStep;
  config: ScheduleJobConfig;
  error_message: string | null;
  schedule_summary: string | null;
  locked_by?: string | null;
  lock_until?: string | null;
  last_heartbeat_at?: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

export type ScheduleJobItemRow = {
  id: string;
  schedule_job_id: string;
  upload_file_id: string | null;
  sort_order: number;
  filename: string;
  media_urls: string[];
  status: ScheduleJobItemStatus;
  scheduled_at: string | null;
  destinations: ScheduleJobDestination[] | null;
  caption: string | null;
  hashtags: string | null;
  created_post_id: string | null;
  parent_publish_group_id: string | null;
  error_message: string | null;
  attempt_count: number;
  created_at: string;
  updated_at: string;
};

import type {
  ScheduleJobPhase,
  ScheduleStepId,
  ScheduleStepState,
} from "@/lib/schedule-jobs/state";
import type { ScheduleJobTiming } from "@/lib/schedule-jobs/timing";

export type ScheduleJobStatusResponse = {
  jobId: string;
  status: ScheduleJobStatus;
  phase: ScheduleJobPhase;
  currentStep: ScheduleJobStep;
  total: number;
  /** Itens com legendas/horários prontos (legado: processed). */
  processed: number;
  /** Posts salvos em scheduled_posts (legado: completed). */
  completed: number;
  failed: number;
  pending: number;
  captionsDone: number;
  hashtagsDone: number;
  calendarDone: number;
  postsSaved: number;
  planChunksTotal: number;
  planChunksDone: number;
  insertChunksTotal: number;
  insertChunksDone: number;
  scheduleSummary: string | null;
  planReady: boolean;
  errorMessage: string | null;
  isActive: boolean;
  workerActive: boolean;
  workerStatus: "processing" | "queued_next" | "stalled" | "idle";
  workerLabel: string;
  canResume: boolean;
  canForceContinue: boolean;
  canFinalizePosts: boolean;
  isStalled: boolean;
  canCancel: boolean;
  canOpenCalendar: boolean;
  hasActiveError: boolean;
  lastHeartbeatAt: string | null;
  lastError: string | null;
  stepLabel: string;
  headline: string;
  progressLabel: string;
  progressPercent: number;
  planSummaryLabel: string | null;
  postsSummaryLabel: string | null;
  steps: Record<ScheduleStepId, ScheduleStepState>;
  updatedAt: string;
  timing: ScheduleJobTiming;
  batchId: string | null;
  scheduleMode: ScheduleJobScheduleMode;
  warmupPattern: string | null;
  skippedPastSlots: Array<{ date: string; time: string; reason: "past_time" }>;
  plannedPosts: Array<{
    dayIndex: number;
    scheduledAt: string;
    slot: string;
    slotSource: "warmup_fixed";
  }>;
  stalledReason: string | null;
  recommendedAction: string | null;
  missingPosts: number;
  postsInCalendar: number;
  pendingSaveItems: number;
  consistencyErrors: Array<{ code: string; message: string }>;
  canDiscardJob?: boolean;
  reconcileError?: boolean;
  reconcileErrorMessage?: string | null;
  reconciled?: boolean;
  statusError?: boolean;
  statusErrorMessage?: string | null;
  ok?: boolean;
};
