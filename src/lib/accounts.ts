import type { SupabaseClient } from "@supabase/supabase-js";
import type { InstagramAccount } from "@/lib/types";

export function ownerAccountsFilter(ownerId: string) {
  return `owner_id.eq.${ownerId},user_id.eq.${ownerId}`;
}

export async function getOwnerAccounts(
  supabase: SupabaseClient,
  ownerId: string,
): Promise<InstagramAccount[]> {
  const { data } = await supabase
    .from("instagram_accounts")
    .select("*")
    .or(ownerAccountsFilter(ownerId))
    .order("created_at", { ascending: false });

  return (data as InstagramAccount[]) ?? [];
}

export async function getOwnerAccountById(
  supabase: SupabaseClient,
  ownerId: string,
  accountId: string,
) {
  const { data } = await supabase
    .from("instagram_accounts")
    .select("*")
    .eq("id", accountId)
    .or(ownerAccountsFilter(ownerId))
    .maybeSingle();

  return data as InstagramAccount | null;
}
