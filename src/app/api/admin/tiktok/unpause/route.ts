import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePlatformAdmin } from "@/lib/admin/gate";
import { formatZodError } from "@/lib/api-errors";
import { getSessionUserId } from "@/lib/meta/oauth";
import { logSecurityEvent } from "@/lib/security/audit";
import { createAdminClient } from "@/lib/supabase/admin";
import { getOwnerTikTokAccountById } from "@/lib/tiktok/accounts";
import { buildTikTokPublishDiagnostics } from "@/lib/tiktok/publish-diagnostics";
import { validateTikTokUnpauseSafety } from "@/lib/tiktok/unpause";

const bodySchema = z.object({
  accountId: z.string().uuid(),
  confirm: z.boolean().optional().default(false),
});

/**
 * Despausa publicação automática de 1 conta TikTok (admin).
 * confirm: false → dry-run com diagnóstico, sem alterar DB.
 * confirm: true → despausa somente se safeToUnpauseTikTok e demais checks passarem.
 */
export async function POST(request: NextRequest) {
  const ownerId = await getSessionUserId();
  if (!ownerId) {
    return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const gate = await requirePlatformAdmin(supabase, ownerId);
  if (!gate.ok) {
    return NextResponse.json({ ok: false, error: "forbidden", message: gate.error }, { status: 403 });
  }

  const raw = await request.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: formatZodError(parsed.error) }, { status: 400 });
  }

  const account = await getOwnerTikTokAccountById(supabase, ownerId, parsed.data.accountId);
  if (!account) {
    return NextResponse.json({ ok: false, error: "account_not_found" }, { status: 404 });
  }

  const diagnostics = await buildTikTokPublishDiagnostics({
    supabase,
    account,
  });

  const safety = validateTikTokUnpauseSafety(diagnostics);

  if (!parsed.data.confirm) {
    return NextResponse.json({
      ok: true,
      dryRun: true,
      wouldUnpause: safety.safe && diagnostics.publishPaused,
      alreadyUnpaused: !diagnostics.publishPaused,
      diagnostics,
      ...(safety.safe ? {} : { blockReason: safety.blockReason, failedChecks: safety.failedChecks }),
    });
  }

  if (!safety.safe) {
    return NextResponse.json(
      {
        ok: false,
        error: "unsafe_to_unpause_tiktok",
        blockReason: safety.blockReason,
        failedChecks: safety.failedChecks,
        diagnostics,
      },
      { status: 409 },
    );
  }

  if (!diagnostics.publishPaused) {
    return NextResponse.json({
      ok: true,
      unpaused: false,
      alreadyUnpaused: true,
      platform: "tiktok",
      account: diagnostics.account,
      accountId: account.id,
      publishPausedBefore: false,
      publishPausedAfter: false,
      diagnostics,
      message: "Conta TikTok já estava despausada.",
    });
  }

  const publishPausedBefore = Boolean(account.publishing_paused);

  const { data: updated, error: updateError } = await supabase
    .from("tiktok_accounts")
    .update({
      publishing_paused: false,
      updated_at: new Date().toISOString(),
    })
    .eq("id", account.id)
    .eq("owner_id", ownerId)
    .select("id, publishing_paused")
    .maybeSingle();

  if (updateError || !updated) {
    return NextResponse.json(
      {
        ok: false,
        error: "unpause_failed",
        message: updateError?.message ?? "Falha ao despausar conta TikTok",
        diagnostics,
      },
      { status: 500 },
    );
  }

  const auditPayload = {
    event: "tiktok_account_unpaused",
    accountId: account.id,
    account: diagnostics.account,
    privacyLevel: diagnostics.cronTikTokPrivacyLevel,
    uploadMethod: diagnostics.uploadMethod,
    safeToUnpauseTikTok: diagnostics.safeToUnpauseTikTok,
  };

  console.info("[tiktok-account-unpaused]", JSON.stringify(auditPayload));

  await logSecurityEvent({
    ownerId: account.owner_id,
    eventType: "tiktok_publish",
    resourceType: "tiktok_account",
    resourceId: account.id,
    metadata: auditPayload,
  });

  return NextResponse.json({
    ok: true,
    unpaused: true,
    platform: "tiktok",
    account: diagnostics.account,
    accountId: account.id,
    publishPausedBefore,
    publishPausedAfter: Boolean(updated.publishing_paused) === false,
    nextStep: "Run GET /api/cron/publish/tiktok manually once",
    diagnostics: {
      ...diagnostics,
      publishPaused: false,
    },
  });
}
