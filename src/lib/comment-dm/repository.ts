import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  CommentDmAutomation,
  CommentDmAutomationWithAccount,
  CommentDmEvent,
} from "@/lib/comment-dm/types";

export async function listAutomationsForOwner(supabase: SupabaseClient, ownerId: string) {
  const { data, error } = await supabase
    .from("comment_dm_automations")
    .select("*, instagram_accounts(id, ig_username, auth_provider, page_id)")
    .eq("owner_id", ownerId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []) as CommentDmAutomationWithAccount[];
}

export async function getAutomationForOwner(
  supabase: SupabaseClient,
  ownerId: string,
  automationId: string,
) {
  const { data, error } = await supabase
    .from("comment_dm_automations")
    .select("*, instagram_accounts(id, ig_username, auth_provider, page_id)")
    .eq("id", automationId)
    .eq("owner_id", ownerId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data as CommentDmAutomationWithAccount | null;
}

export async function listEventsForAutomation(
  supabase: SupabaseClient,
  ownerId: string,
  automationId: string,
  limit = 50,
) {
  const { data, error } = await supabase
    .from("comment_dm_events")
    .select("*")
    .eq("owner_id", ownerId)
    .eq("automation_id", automationId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(error.message);
  return (data ?? []) as CommentDmEvent[];
}

export async function listEnabledAutomationsWithAccounts(supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from("comment_dm_automations")
    .select("*, instagram_accounts(*)")
    .eq("enabled", true);

  if (error) throw new Error(error.message);
  return (data ?? []) as Array<
    CommentDmAutomation & { instagram_accounts: CommentDmAutomationWithAccount["instagram_accounts"] }
  >;
}

export async function incrementAutomationStats(
  supabase: SupabaseClient,
  automationId: string,
  delta: { detected?: number; sent?: number; failures?: number },
) {
  const { data: current } = await supabase
    .from("comment_dm_automations")
    .select("total_comments_detected, total_dms_sent, total_failures")
    .eq("id", automationId)
    .single();

  if (!current) return;

  await supabase
    .from("comment_dm_automations")
    .update({
      total_comments_detected:
        Number(current.total_comments_detected) + (delta.detected ?? 0),
      total_dms_sent: Number(current.total_dms_sent) + (delta.sent ?? 0),
      total_failures: Number(current.total_failures) + (delta.failures ?? 0),
      updated_at: new Date().toISOString(),
    })
    .eq("id", automationId);
}

export async function touchAutomationPolledAt(supabase: SupabaseClient, automationId: string) {
  await supabase
    .from("comment_dm_automations")
    .update({ last_polled_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", automationId);
}

export async function findAccountByIgUserId(supabase: SupabaseClient, igUserId: string) {
  const { data } = await supabase
    .from("instagram_accounts")
    .select("*")
    .eq("ig_user_id", igUserId)
    .limit(1)
    .maybeSingle();

  return data;
}
