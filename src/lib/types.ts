export type MediaType = "IMAGE" | "REELS" | "CAROUSEL";
export type ContentType = "reel" | "post" | "story" | "tiktok_video" | "youtube_short";
export type PostStatus = "pending" | "processing" | "published" | "failed";
export type LogLevel = "info" | "error" | "success";
export type SocialPlatform = "instagram" | "tiktok";

export interface InstagramAccount {
  id: string;
  owner_id: string | null;
  user_id: string;
  ig_user_id: string;
  ig_username: string | null;
  page_id: string;
  page_access_token: string;
  profile_picture_url: string | null;
  auth_provider?: "instagram" | "facebook" | null;
  warmup_enabled?: boolean;
  warmup_days?: number;
  warmup_started_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface TikTokAccount {
  id: string;
  owner_id: string;
  open_id: string;
  username: string | null;
  display_name: string | null;
  profile_picture_url: string | null;
  access_token: string;
  refresh_token: string;
  token_expires_at: string | null;
  refresh_expires_at: string | null;
  scopes: string | null;
  created_at: string;
  updated_at: string;
}

export interface ScheduledPost {
  id: string;
  account_id: string | null;
  platform?: SocialPlatform;
  tiktok_account_id?: string | null;
  youtube_account_id?: string | null;
  content_type?: ContentType | null;
  media_type: MediaType;
  media_urls: string[];
  caption: string | null;
  title?: string | null;
  description?: string | null;
  hashtags?: string | null;
  story_cta?: string | null;
  story_link?: string | null;
  story_objective?: string | null;
  content_objective?: string | null;
  campaign_id?: string | null;
  product_id?: string | null;
  upload_batch_id?: string | null;
  parent_publish_group_id?: string | null;
  retry_count?: number;
  is_draft?: boolean;
  publish_block_reason?: string | null;
  scheduled_at: string;
  status: PostStatus;
  container_id: string | null;
  media_id: string | null;
  permalink: string | null;
  error_message: string | null;
  published_at: string | null;
  media_cleaned_at?: string | null;
  hidden_from_report?: boolean;
  created_at: string;
  instagram_accounts?: Pick<InstagramAccount, "ig_username" | "profile_picture_url">;
  tiktok_accounts?: Pick<TikTokAccount, "username" | "display_name" | "profile_picture_url">;
}

export type ScheduledPostWithAccountSecrets = ScheduledPost & {
  instagram_accounts?: Pick<
    InstagramAccount,
    "ig_username" | "profile_picture_url" | "ig_user_id" | "page_access_token" | "auth_provider"
  >;
};

export interface PublishLog {
  id: string;
  post_id: string;
  level: LogLevel;
  message: string;
  created_at: string;
}

export interface AiPlaybook {
  owner_id: string;
  brand_name: string | null;
  niche: string | null;
  target_audience: string | null;
  tone_voice: string | null;
  viral_hooks: string | null;
  hashtag_strategy: string | null;
  cta_style: string | null;
  example_captions: string | null;
  avoid_rules: string | null;
  extra_knowledge: string | null;
  playbooks_by_account?: Record<string, AccountPlaybookPayload> | null;
  created_at: string;
  updated_at: string;
}

export type AccountPlaybookPayload = Omit<
  AiPlaybook,
  "owner_id" | "created_at" | "updated_at" | "playbooks_by_account"
>;

export type UploadBatchStatus = "uploading" | "ready" | "scheduling" | "scheduled" | "cancelled";
export type UploadFileStatus = "pending" | "uploading" | "completed" | "failed";
export type UploadSpeedMode = "economy" | "normal" | "turbo";

export interface UploadBatchFile {
  id: string;
  batch_id: string;
  filename: string;
  file_size: number;
  content_type: string;
  storage_path: string;
  public_url: string | null;
  status: UploadFileStatus;
  bytes_uploaded: number;
  error_message: string | null;
  file_hash?: string | null;
  last_modified?: number | null;
  retry_count?: number;
  duration_seconds?: number | null;
  removed?: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface UploadBatch {
  id: string;
  owner_id: string;
  account_id: string | null;
  platform?: SocialPlatform;
  tiktok_account_id?: string | null;
  schedule_mode: "today" | "auto" | "warmup" | "custom";
  custom_schedule: {
    posts_per_day?: number;
    time_slots?: string[];
    start_time?: string;
    end_time?: string;
  } | null;
  status: UploadBatchStatus;
  total_files: number;
  completed_files: number;
  failed_files: number;
  batch_number: number;
  paused?: boolean;
  upload_speed_mode?: UploadSpeedMode;
  started_at?: string | null;
  finished_at?: string | null;
  auto_schedule_enabled?: boolean;
  created_at: string;
  updated_at: string;
  upload_files?: UploadBatchFile[];
  instagram_accounts?: Pick<InstagramAccount, "ig_username">;
}
