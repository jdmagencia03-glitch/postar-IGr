import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getPlaybookForAccount,
  playbookHasContent,
  savePlaybookForAccount,
} from "@/lib/ai/playbook";
import { accountHandle, getInstagramAccountForAdmin } from "@/lib/instagram/admin-gate";
import {
  resolvePlaybookPayload,
  type PlaybookPresetId,
} from "@/lib/instagram/playbook-presets";
import type { AccountPlaybookPayload } from "@/lib/types";

async function resolveNoPlaybookOperationalErrors(
  supabase: SupabaseClient,
  ownerId: string,
  accountId: string,
) {
  const now = new Date().toISOString();
  await supabase
    .from("operational_errors")
    .update({
      status: "resolved",
      resolved_at: now,
      updated_at: now,
    })
    .eq("owner_id", ownerId)
    .eq("account_id", accountId)
    .eq("error_type", "account_no_playbook")
    .in("status", ["open", "investigating", "auto_retrying", "needs_user_action"]);
}

export async function configureInstagramPlaybook(params: {
  supabase: SupabaseClient;
  ownerId: string;
  accountId: string;
  playbookName?: string | null;
  preset?: PlaybookPresetId | null;
  playbook?: Partial<AccountPlaybookPayload> | null;
  confirm: boolean;
}) {
  const account = await getInstagramAccountForAdmin(
    params.supabase,
    params.ownerId,
    params.accountId,
  );

  if (!account) {
    return { ok: false as const, error: "account_not_found" as const };
  }

  const handle = accountHandle(account.ig_username, account.id);
  const existing = await getPlaybookForAccount(params.ownerId, params.accountId);
  const playbookConfiguredBefore = playbookHasContent(existing);

  let payload: AccountPlaybookPayload;
  try {
    payload = resolvePlaybookPayload({
      accountId: params.accountId,
      preset: params.preset,
      playbookName: params.playbookName,
      playbook: params.playbook,
    });
  } catch {
    return { ok: false as const, error: "invalid_playbook" as const };
  }

  if (!playbookHasContent(payload)) {
    return {
      ok: false as const,
      error: "empty_playbook" as const,
      message: "Informe preset, playbook ou playbookName com conteúdo suficiente.",
    };
  }

  const dryRunPayload = {
    ok: true as const,
    dryRun: true as const,
    account: handle,
    ownerId: params.ownerId,
    accountId: params.accountId,
    playbookConfiguredBefore,
    playbookConfiguredAfter: true,
    wouldApply: true,
    playbookPreview: {
      brand_name: payload.brand_name,
      niche: payload.niche,
      target_audience: payload.target_audience?.slice(0, 120),
    },
    nextStep: "confirm_true_to_save" as const,
  };

  if (!params.confirm) {
    return dryRunPayload;
  }

  await savePlaybookForAccount(params.ownerId, params.accountId, payload);
  await resolveNoPlaybookOperationalErrors(params.supabase, params.ownerId, params.accountId);

  const saved = await getPlaybookForAccount(params.ownerId, params.accountId);
  const playbookConfiguredAfter = playbookHasContent(saved);

  return {
    ok: true as const,
    dryRun: false as const,
    account: handle,
    ownerId: params.ownerId,
    accountId: params.accountId,
    playbookConfiguredBefore,
    playbookConfiguredAfter,
    playbookName: payload.brand_name,
    nextStep: "run_platform_audit" as const,
  };
}
