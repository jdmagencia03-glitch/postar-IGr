import type { SupabaseClient } from "@supabase/supabase-js";
import type { TikTokAccount } from "@/lib/types";
import {
  decryptTikTokAccessToken,
  decryptTikTokRefreshToken,
  encryptTikTokAccessToken,
  encryptTikTokRefreshToken,
} from "@/lib/security/tokens";
import { refreshAccessToken } from "@/lib/tiktok/oauth";

export async function getOwnerTikTokAccounts(
  supabase: SupabaseClient,
  ownerId: string,
): Promise<TikTokAccount[]> {
  const { data } = await supabase
    .from("tiktok_accounts")
    .select("*")
    .eq("owner_id", ownerId)
    .order("created_at", { ascending: false });

  return (data as TikTokAccount[]) ?? [];
}

export async function getOwnerTikTokAccountById(
  supabase: SupabaseClient,
  ownerId: string,
  accountId: string,
) {
  const { data } = await supabase
    .from("tiktok_accounts")
    .select("*")
    .eq("id", accountId)
    .eq("owner_id", ownerId)
    .maybeSingle();

  return data as TikTokAccount | null;
}

export async function getOwnerTikTokAccountByOpenId(
  supabase: SupabaseClient,
  ownerId: string,
  openId: string,
) {
  const { data } = await supabase
    .from("tiktok_accounts")
    .select("*")
    .eq("open_id", openId)
    .eq("owner_id", ownerId)
    .maybeSingle();

  return data as TikTokAccount | null;
}

function isExpired(isoDate: string | null | undefined, bufferMs = 5 * 60 * 1000) {
  if (!isoDate) return true;
  return new Date(isoDate).getTime() - bufferMs <= Date.now();
}

export async function ensureTikTokAccessToken(
  supabase: SupabaseClient,
  account: TikTokAccount,
): Promise<string> {
  const current = decryptTikTokAccessToken(account.access_token);
  if (current && !isExpired(account.token_expires_at)) {
    return current;
  }

  const refreshToken = decryptTikTokRefreshToken(account.refresh_token);
  if (!refreshToken) {
    throw new Error("Token TikTok indisponível. Reconecte a conta.");
  }

  const refreshed = await refreshAccessToken(refreshToken);
  const tokenExpiresAt = new Date(Date.now() + refreshed.expires_in * 1000).toISOString();
  const refreshExpiresAt = new Date(Date.now() + refreshed.refresh_expires_in * 1000).toISOString();

  await supabase
    .from("tiktok_accounts")
    .update({
      access_token: encryptTikTokAccessToken(refreshed.access_token),
      refresh_token: encryptTikTokRefreshToken(refreshed.refresh_token),
      token_expires_at: tokenExpiresAt,
      refresh_expires_at: refreshExpiresAt,
      scopes: refreshed.scope,
      updated_at: new Date().toISOString(),
    })
    .eq("id", account.id);

  return refreshed.access_token;
}

export function mapTikTokAccountResponse(account: TikTokAccount) {
  return {
    id: account.id,
    open_id: account.open_id,
    username: account.username,
    display_name: account.display_name,
    profile_picture_url: account.profile_picture_url,
    scopes: account.scopes,
    created_at: account.created_at,
    updated_at: account.updated_at,
  };
}
