import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DEFAULT_WARMUP_DAYS,
  resolveAutoScheduleOptions,
  type AutoAccountProfile,
} from "@/lib/account-warmup";
import { getOwnerAccountById } from "@/lib/accounts";
import { resolveSchedulingCampaignContext } from "@/lib/campaigns/context";
import { contentTypeForPlatform } from "@/lib/content-types";
import type { PublishTarget } from "@/lib/multiplatform/types";
import { parseCustomSchedulePayload } from "@/lib/smart-schedule";
import { getOwnerTikTokAccountById } from "@/lib/tiktok/accounts";
import type { ScheduleJobConfig, ScheduleJobRow } from "@/lib/schedule-jobs/types";
import type { InstagramAccount, TikTokAccount } from "@/lib/types";

export async function loadAccountsMap(
  supabase: SupabaseClient,
  ownerId: string,
  targets: PublishTarget[],
) {
  const accounts = new Map<string, InstagramAccount | TikTokAccount>();
  for (const target of targets) {
    if (accounts.has(target.account_id)) continue;
    if (target.platform === "tiktok") {
      const account = await getOwnerTikTokAccountById(supabase, ownerId, target.account_id);
      if (!account) throw new Error(`Conta TikTok não encontrada: ${target.account_id}`);
      accounts.set(target.account_id, account);
    } else {
      const account = await getOwnerAccountById(supabase, ownerId, target.account_id);
      if (!account) throw new Error(`Conta não encontrada: ${target.account_id}`);
      accounts.set(target.account_id, account);
    }
  }
  return accounts;
}

export function resolveWarmup(
  scheduleMode: string,
  insertionPlatform: string,
  primaryAccount: InstagramAccount | TikTokAccount,
) {
  if (scheduleMode !== "warmup") return undefined;
  if (insertionPlatform === "instagram") {
    const ig = primaryAccount as InstagramAccount;
    return {
      warmupDays: ig.warmup_days ?? DEFAULT_WARMUP_DAYS,
    };
  }
  return { warmupDays: DEFAULT_WARMUP_DAYS };
}

export async function resolveJobPlanningContext(
  supabase: SupabaseClient,
  ownerId: string,
  job: ScheduleJobRow,
) {
  const config = job.config as ScheduleJobConfig;
  const targets = config.targets ?? [];
  if (!targets.length) throw new Error("Nenhum destino configurado no job");

  const accounts = await loadAccountsMap(supabase, ownerId, targets);
  const insertionTarget = targets[0]!;
  const primaryAccount = accounts.get(insertionTarget.account_id)!;
  const scheduleMode = config.schedule_mode ?? "auto";
  const custom =
    scheduleMode === "custom" && config.custom_schedule
      ? parseCustomSchedulePayload(config.custom_schedule)
      : undefined;
  const auto =
    scheduleMode === "auto"
      ? resolveAutoScheduleOptions({
          profile: config.auto_profile as AutoAccountProfile | undefined,
          igAccount:
            insertionTarget.platform === "instagram"
              ? (primaryAccount as InstagramAccount)
              : null,
        })
      : undefined;
  const campaignContext = await resolveSchedulingCampaignContext(supabase, ownerId, {
    product_id: config.product_id,
    campaign_id: config.campaign_id,
    content_objective: config.content_objective,
  });

  return {
    config,
    targets,
    accounts,
    insertionTarget,
    primaryAccount,
    scheduleMode,
    custom,
    auto,
    campaignContext,
  };
}

export function accountUsername(
  platform: "instagram" | "tiktok",
  account: InstagramAccount | TikTokAccount,
) {
  if (platform === "tiktok") {
    const tt = account as TikTokAccount;
    return tt.username ?? tt.display_name ?? "conta";
  }
  return (account as InstagramAccount).ig_username ?? "conta";
}
