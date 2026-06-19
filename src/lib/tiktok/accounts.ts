import type { SupabaseClient } from "@supabase/supabase-js";
import type { TikTokAccount, TikTokAccountStatus } from "@/lib/types";
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

  return (data as TikTokAccount | null) ?? null;
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

  return (data as TikTokAccount | null) ?? null;
}

function isExpired(isoDate: string | null | undefined, bufferMs = 5 * 60 * 1000) {
  if (!isoDate) return true;
  return new Date(isoDate).getTime() - bufferMs <= Date.now();
}

function isRefreshExpired(isoDate: string | null | undefined) {
  if (!isoDate) return false;
  return new Date(isoDate).getTime() <= Date.now();
}

export async function markTikTokAccountStatus(
  supabase: SupabaseClient,
  accountId: string,
  patch: {
    status?: TikTokAccountStatus;
    last_validated_at?: string | null;
    last_validation_error?: string | null;
    creator_max_duration_sec?: number | null;
    creator_username?: string | null;
    display_name?: string | null;
    profile_picture_url?: string | null;
  },
) {
  await supabase
    .from("tiktok_accounts")
    .update({
      ...patch,
      updated_at: new Date().toISOString(),
    })
    .eq("id", accountId);
}

/** Obtém access_token válido, renovando automaticamente quando necessário. */
export async function getValidTikTokAccessToken(
  supabase: SupabaseClient,
  account: TikTokAccount,
): Promise<string> {
  const current = decryptTikTokAccessToken(account.access_token);
  if (current && !isExpired(account.token_expires_at)) {
    return current;
  }

  if (isRefreshExpired(account.refresh_expires_at)) {
    await markTikTokAccountStatus(supabase, account.id, {
      status: "error",
      last_validation_error: "Refresh token expirado. Reconecte a conta TikTok.",
    });
    throw new Error("Refresh token expirado. Reconecte a conta TikTok.");
  }

  const refreshToken = decryptTikTokRefreshToken(account.refresh_token);
  if (!refreshToken) {
    await markTikTokAccountStatus(supabase, account.id, {
      status: "error",
      last_validation_error: "Token TikTok indisponível. Reconecte a conta.",
    });
    throw new Error("Token TikTok indisponível. Reconecte a conta.");
  }

  try {
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
        status: "active",
        last_validation_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", account.id);

    return refreshed.access_token;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao renovar token TikTok";
    await markTikTokAccountStatus(supabase, account.id, {
      status: "error",
      last_validation_error: message,
    });
    throw new Error(`${message} Reconecte a conta TikTok.`);
  }
}

/** @deprecated Use getValidTikTokAccessToken */
export const ensureTikTokAccessToken = getValidTikTokAccessToken;

export function mapTikTokAccountResponse(account: TikTokAccount) {
  const tokenValid =
    account.token_expires_at && new Date(account.token_expires_at).getTime() > Date.now();

  return {
    id: account.id,
    open_id: account.open_id,
    username: account.username ?? account.creator_username,
    display_name: account.display_name,
    profile_picture_url: account.profile_picture_url,
    scopes: account.scopes,
    status: account.status ?? "active",
    token_valid: Boolean(tokenValid),
    token_expires_at: account.token_expires_at,
    refresh_expires_at: account.refresh_expires_at,
    publishing_paused: account.publishing_paused ?? false,
    last_validated_at: account.last_validated_at ?? null,
    last_validation_error: account.last_validation_error ?? null,
    creator_max_duration_sec: account.creator_max_duration_sec ?? null,
    created_at: account.created_at,
    updated_at: account.updated_at,
  };
}
