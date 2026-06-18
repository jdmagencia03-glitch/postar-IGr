import type { ContentType, SocialPlatform } from "@/lib/types";

export type PublishDestination = "instagram" | "tiktok" | "both";

export interface PublishTarget {
  platform: Exclude<SocialPlatform, never>;
  account_id: string;
}

export interface MultiplatformDestinationPreview {
  platform: SocialPlatform;
  account_id: string;
  username: string;
  caption: string;
  scheduled_at: string;
  content_type: ContentType;
}

export interface MultiplatformVideoPreview {
  index: number;
  filename: string;
  parent_publish_group_id: string;
  media_urls: string[];
  destinations: MultiplatformDestinationPreview[];
}

export interface MultiplatformConfirmDestination {
  platform: SocialPlatform;
  account_id: string;
  caption: string;
  scheduled_at: string;
}

export interface MultiplatformConfirmVideo {
  parent_publish_group_id: string;
  media_urls: string[];
  filename?: string;
  destinations: MultiplatformConfirmDestination[];
}

export const DESTINATION_LABELS: Record<PublishDestination, string> = {
  instagram: "Instagram Reels",
  tiktok: "TikTok",
  both: "Instagram Reels + TikTok",
};

export const TIKTOK_SCHEDULE_OFFSET_MINUTES = 15;
