import type { SupabaseClient } from "@supabase/supabase-js";
import { INSTAGRAM_RATE_LIMIT_CODE } from "@/lib/instagram/errors";
import { logPublishEvent } from "@/lib/publish/cron";

export const INSTAGRAM_RATE_LIMIT_COOLDOWN_MS = 6 * 60 * 60_000;

export function isAccountInCooldown(cooldownUntil: string | null | undefined, now = Date.now()) {
  if (!cooldownUntil) return false;
  return new Date(cooldownUntil).getTime() > now;
}

export function nextInstagramCooldownUntil(now = new Date()) {
  return new Date(now.getTime() + INSTAGRAM_RATE_LIMIT_COOLDOWN_MS).toISOString();
}

export async function applyInstagramRateLimitCooldown(params: {
  supabase: SupabaseClient;
  accountId: string;
  postId?: string;
  pauseAccount?: boolean;
  reason?: string;
}) {
  const cooldownUntil = nextInstagramCooldownUntil();
  const pauseReason = params.reason ?? INSTAGRAM_RATE_LIMIT_CODE;

  await params.supabase
    .from("instagram_accounts")
    .update({
      cooldown_until: cooldownUntil,
      pause_reason: pauseReason,
      ...(params.pauseAccount ? { publishing_paused: true } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("id", params.accountId);

  if (params.postId) {
    await logPublishEvent(
      params.supabase,
      params.postId,
      "info",
      `account_skipped_cooldown: conta em cooldown até ${cooldownUntil} (${pauseReason}).`,
    );
  }

  return cooldownUntil;
}
