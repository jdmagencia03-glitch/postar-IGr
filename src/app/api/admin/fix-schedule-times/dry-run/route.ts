import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authorizeCronRequest } from "@/lib/admin/cron-auth";
import { requirePlatformAdmin } from "@/lib/admin/gate";
import { getAtomicApplyReadiness } from "@/lib/admin/apply-schedule-moves-atomic";
import {
  previewScheduleFix,
  ScheduleFixScopeError,
} from "@/lib/admin/fix-schedule-times";
import { resolvePlatformAdminOwnerId } from "@/lib/admin/resolve-owner";
import { formatZodError } from "@/lib/api-errors";
import { getSessionUserId } from "@/lib/meta/oauth";
import { createAdminClient } from "@/lib/supabase/admin";

const bodySchema = z.object({
  platform: z.enum(["instagram", "tiktok"]),
  accountId: z.string().uuid(),
});

function scopeErrorResponse(err: ScheduleFixScopeError) {
  return NextResponse.json(
    { ok: false, error: err.code, message: err.message },
    { status: err.status },
  );
}

export async function POST(request: NextRequest) {
  const raw = await request.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(raw);

  if (!parsed.success) {
    const body = raw as { platform?: string; accountId?: string };
    if (!body.platform || !body.accountId) {
      return NextResponse.json(
        {
          ok: false,
          error: "scope_required",
          message: "Escolha uma conta e plataforma antes de aplicar.",
        },
        { status: 400 },
      );
    }
    return NextResponse.json({ ok: false, error: formatZodError(parsed.error) }, { status: 400 });
  }

  const supabase = createAdminClient();
  let ownerId = await getSessionUserId();

  if (!ownerId && authorizeCronRequest(request)) {
    ownerId = await resolvePlatformAdminOwnerId(supabase);
  }

  if (!ownerId) {
    return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  }

  const gate = await requirePlatformAdmin(supabase, ownerId);
  if (!gate.ok) {
    return NextResponse.json({ ok: false, error: "forbidden", message: gate.error }, { status: 403 });
  }

  try {
    const [preview, atomicApply] = await Promise.all([
      previewScheduleFix({
        supabase,
        ownerId,
        platform: parsed.data.platform,
        accountId: parsed.data.accountId,
      }),
      getAtomicApplyReadiness(supabase),
    ]);

    console.info("[fix-schedule-times-dry-run]", {
      ownerId,
      accountId: parsed.data.accountId,
      platform: parsed.data.platform,
      postsToChange: preview.totals.postsToChange,
      safeToApply: preview.account.safeToApply,
      atomicApplyReady: atomicApply.atomicApplyReady,
    });

    return NextResponse.json({
      ...preview,
      atomicApplyReady: atomicApply.atomicApplyReady,
      dbCredentialMode: atomicApply.dbCredentialMode,
      rpcAvailable: atomicApply.rpcAvailable,
    });
  } catch (err) {
    if (err instanceof ScheduleFixScopeError) {
      return scopeErrorResponse(err);
    }
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Falha no dry-run de horários" },
      { status: 500 },
    );
  }
}
