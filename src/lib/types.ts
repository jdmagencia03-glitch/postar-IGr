export type MediaType = "IMAGE" | "REELS" | "CAROUSEL";
export type PostStatus = "pending" | "processing" | "published" | "failed";
export type LogLevel = "info" | "error" | "success";

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

export interface ScheduledPost {
  id: string;
  account_id: string;
  media_type: MediaType;
  media_urls: string[];
  caption: string | null;
  scheduled_at: string;
  status: PostStatus;
  container_id: string | null;
  media_id: string | null;
  permalink: string | null;
  error_message: string | null;
  published_at: string | null;
  created_at: string;
  instagram_accounts?: Pick<InstagramAccount, "ig_username" | "profile_picture_url">;
}

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
  created_at: string;
  updated_at: string;
}
