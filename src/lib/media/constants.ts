/** Posts nestes status bloqueiam delete do objeto no Storage. */
export const MEDIA_REFERENCED_POST_STATUSES = [
  "pending",
  "processing",
  "retrying",
  "failed",
  "failed_persistent",
  "needs_media",
] as const;

export type MediaReferencedPostStatus = (typeof MEDIA_REFERENCED_POST_STATUSES)[number];

export const MEDIA_ASSET_SAFE_DELETE_STATUSES = ["validated", "attached", "safe_to_delete"] as const;

export const UPLOAD_FILE_SCHEDULABLE_STATUSES = ["completed"] as const;

export const MEDIA_INTEGRITY_PAUSE_THRESHOLD = 3;
export const MEDIA_INTEGRITY_PAUSE_WINDOW_MS = 30 * 60 * 1000;

export const MEDIA_MISSING_ERROR_CODE = "video_storage_object_missing";
export const MEDIA_MISSING_LOG = "post_skipped_missing_media";
export const STORAGE_DELETE_BLOCKED_LOG = "storage_delete_blocked_asset_referenced_by_posts";
