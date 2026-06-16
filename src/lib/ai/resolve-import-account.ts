import { getOwnerAccountById, getOwnerAccounts } from "@/lib/accounts";
import { createAdminClient } from "@/lib/supabase/admin";

export async function resolveImportAccount(ownerId: string, accountId?: string | null) {
  const supabase = createAdminClient();

  if (accountId) {
    const account = await getOwnerAccountById(supabase, ownerId, accountId);
    if (account) return account;
  }

  const accounts = await getOwnerAccounts(supabase, ownerId);
  return accounts[0] ?? null;
}
