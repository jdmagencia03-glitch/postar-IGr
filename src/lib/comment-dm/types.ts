import type { InstagramAccount } from "@/lib/types";

export type CommentDmApplyTo = "all" | "specific";
export type CommentDmEventStatus = "pending" | "sent" | "failed" | "skipped";
export type CommentDmEventSource = "webhook" | "poll" | "manual";

export interface CommentDmAutomation {
  id: string;
  owner_id: string;
  account_id: string;
  name: string;
  enabled: boolean;
  dm_message_template: string;
  dm_link: string | null;
  apply_to: CommentDmApplyTo;
  target_media_ids: string[];
  keywords: string[];
  total_comments_detected: number;
  total_dms_sent: number;
  total_failures: number;
  last_polled_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CommentDmEvent {
  id: string;
  automation_id: string;
  account_id: string;
  owner_id: string;
  comment_id: string;
  media_id: string | null;
  commenter_ig_id: string | null;
  commenter_username: string | null;
  comment_text: string | null;
  matched_keyword: string | null;
  rendered_message: string | null;
  status: CommentDmEventStatus;
  error_message: string | null;
  api_response: Record<string, unknown> | null;
  source: CommentDmEventSource;
  comment_created_at: string | null;
  processed_at: string | null;
  created_at: string;
}

export interface IncomingCommentPayload {
  commentId: string;
  mediaId?: string;
  text: string;
  commenterIgId?: string;
  commenterUsername?: string;
  commentCreatedAt?: string;
  igUserId: string;
  accountId?: string;
  source: CommentDmEventSource;
}

export interface CommentDmAutomationWithAccount extends CommentDmAutomation {
  instagram_accounts?: Pick<InstagramAccount, "id" | "ig_username" | "auth_provider" | "page_id"> | null;
}
