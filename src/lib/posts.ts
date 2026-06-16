import type { SupabaseClient } from "@supabase/supabase-js";
import { getOwnerAccounts } from "@/lib/accounts";
import type { PostStatus, ScheduledPostWithAccountSecrets } from "@/lib/types";

export async function getOwnerPostById(
  supabase: SupabaseClient,
  ownerId: string,
  postId: string,
) {
  const accounts = await getOwnerAccounts(supabase, ownerId);
  const accountIds = accounts.map((account) => account.id);
  if (!accountIds.length) return null;

  const { data } = await supabase
    .from("scheduled_posts")
    .select(
      "*, instagram_accounts(ig_username, profile_picture_url, ig_user_id, page_access_token, auth_provider)",
    )
    .eq("id", postId)
    .in("account_id", accountIds)
    .maybeSingle();

  return data as ScheduledPostWithAccountSecrets | null;
}

export function canEditPost(status: PostStatus) {
  return status === "pending" || status === "failed";
}

export function canReschedulePost(status: PostStatus) {
  return status === "pending" || status === "failed";
}

export function canDeleteSchedule(status: PostStatus) {
  return status === "pending" || status === "failed" || status === "processing";
}

export function canRetryPost(status: PostStatus) {
  return status === "failed";
}

export function canHideFromReport(status: PostStatus) {
  return status === "published";
}

export function canDeleteFromInstagram(status: PostStatus) {
  return status === "published";
}
