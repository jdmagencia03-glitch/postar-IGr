import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePlatformAdmin } from "@/lib/admin/gate";
import {
  applyScheduleFix,
  ScheduleFixScopeError,
} from "@/lib/admin/fix-schedule-times";
import { getAtomicApplyReadiness, ScheduleFixApplyError } from "@/lib/admin/apply-schedule-moves-atomic";
import { formatZodError } from "@/lib/api-errors";
import { getSessionUserId } from "@/lib/meta/oauth";
import { createAdminClient } from "@/lib/supabase/admin";

const bodySchema = z.object({
  platform: z.enum(["instagram", "tiktok"]),
  accountId: z.string().uuid(),
  confirm: z.literal(true, {
    error: "Envie confirm: true para aplicar a correção de horários",
  }),
});

function scopeErrorResponse(err: ScheduleFixScopeError) {
  return NextResponse.json(
    { ok: false, error: err.code, message: err.message },
    { status: err.status },
  );
}

export async function POST(request: NextRequest) {
  const raw = await request.json().catch(() => ({}));
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

  const ownerId = await getSessionUserId();
  if (!ownerId) {
    return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const gate = await requirePlatformAdmin(supabase, ownerId);
  if (!gate.ok) {
    return NextResponse.json({ ok: false, error: "forbidden", message: gate.error }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(raw);

  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: formatZodError(parsed.error) }, { status: 400 });
  }

  try {
    const atomicApply = await getAtomicApplyReadiness(supabase);
    if (!atomicApply.atomicApplyReady) {
      return NextResponse.json(
        {
          ok: false,
          error: "missing_db_credentials",
          message:
            "Configure DATABASE_URL ou SUPABASE_DB_PASSWORD para apply atômico, ou aplique supabase/apply-schedule-moves-atomic.sql no Supabase.",
          atomicApplyReady: false,
          dbCredentialMode: atomicApply.dbCredentialMode,
          rpcAvailable: atomicApply.rpcAvailable,
        },
        { status: 503 },
      );
    }

    const result = await applyScheduleFix({
      supabase,
      ownerId,
      platform: parsed.data.platform,
      accountId: parsed.data.accountId,
    });

    console.info("[fix-schedule-times-applied]", {
      ownerId,
      accountId: parsed.data.accountId,
      platform: parsed.data.platform,
      postsChanged: result.totals.postsChanged,
      verificationOk: result.verification.ok,
    });

    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ScheduleFixScopeError) {
      return scopeErrorResponse(err);
    }
    if (err instanceof ScheduleFixApplyError) {
      const atomicApply =
        err.code === "missing_db_credentials"
          ? await getAtomicApplyReadiness(supabase)
          : null;
      return NextResponse.json(
        {
          ok: false,
          error: err.code,
          message: err.message,
          ...(atomicApply
            ? {
                atomicApplyReady: atomicApply.atomicApplyReady,
                dbCredentialMode: atomicApply.dbCredentialMode,
                rpcAvailable: atomicApply.rpcAvailable,
              }
            : {}),
        },
        { status: err.status },
      );
    }
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Falha ao aplicar correção de horários" },
      { status: 500 },
    );
  }
}
