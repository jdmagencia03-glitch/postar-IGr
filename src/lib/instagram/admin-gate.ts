import type { SupabaseClient } from "@supabase/supabase-js";
import { ownerAccountsFilter } from "@/lib/accounts";
import type { InstagramAccount } from "@/lib/types";

export async function getInstagramAccountForAdmin(
  supabase: SupabaseClient,
  ownerId: string,
  accountId: string,
): Promise<InstagramAccount | null> {
  const { data, error } = await supabase
    .from("instagram_accounts")
    .select("*")
    .eq("id", accountId)
    .or(ownerAccountsFilter(ownerId))
    .maybeSingle();

  if (error) throw new Error(error.message);
  return (data as InstagramAccount | null) ?? null;
}

export function accountHandle(username: string | null, accountId: string) {
  if (!username) return `@${accountId.slice(0, 8)}`;
  return username.startsWith("@") ? username : `@${username}`;
}
