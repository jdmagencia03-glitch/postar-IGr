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

export type ScheduleJobStatusResponse = {
  jobId: string;
  status: ScheduleJobStatus;
  currentStep: ScheduleJobStep;
  total: number;
  processed: number;
  completed: number;
  failed: number;
  pending: number;
  planChunksTotal: number;
  planChunksDone: number;
  insertChunksTotal: number;
  insertChunksDone: number;
  scheduleSummary: string | null;
  errorMessage: string | null;
  isActive: boolean;
  canResume: boolean;
  stepLabel: string;
};
