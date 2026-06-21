export type ScheduleTaskPhase = "captions" | "calendar" | "save_posts";

export type ScheduleTaskStatus = "pending" | "processing" | "completed" | "failed" | "cancelled";

export type ScheduleJobTaskRow = {
  id: string;
  schedule_job_id: string;
  owner_id: string;
  account_key: string;
  phase: ScheduleTaskPhase;
  chunk_index: number;
  item_ids: string[];
  status: ScheduleTaskStatus;
  attempt_count: number;
  max_attempts: number;
  next_retry_at: string | null;
  locked_by: string | null;
  lock_until: string | null;
  last_heartbeat_at: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};
