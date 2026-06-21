import type { InstagramAccount, TikTokAccount } from "@/lib/types";
import type { TokenStatus } from "@/lib/operations/account-ops";

export function deriveInstagramTokenStatus(account?: InstagramAccount | null): TokenStatus {
  if (!account) return "unknown";
  if (!account.page_access_token?.trim()) return "expired";
  return "valid";
}

export function deriveTikTokTokenStatus(account?: TikTokAccount | null): TokenStatus {
  if (!account) return "unknown";
  if (account.status === "error" || account.status === "disconnected") return "expired";
  if (account.last_validation_error) return "expired";
  if (!account.access_token?.trim()) return "expired";
  if (!account.token_expires_at) return "valid";
  return new Date(account.token_expires_at).getTime() > Date.now() ? "valid" : "expired";
}

export function deriveAccountTokenStatus(params: {
  platform: "instagram" | "tiktok";
  igAccount?: InstagramAccount | null;
  tiktokAccount?: TikTokAccount | null;
}): TokenStatus {
  if (params.platform === "tiktok") {
    return deriveTikTokTokenStatus(params.tiktokAccount);
  }
  return deriveInstagramTokenStatus(params.igAccount);
}

export function formatTokenStatusLabel(status: TokenStatus) {
  if (status === "valid") return "Válido";
  if (status === "expired") return "Expirado";
  return "Não verificado";
}

export function tokenStatusIsValid(status: TokenStatus) {
  return status === "valid";
}
