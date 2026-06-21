import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePlatformAdmin } from "@/lib/admin/gate";
import {
  inspectScheduleFixApply,
  ScheduleFixScopeError,
} from "@/lib/admin/fix-schedule-times";
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

/** Inspeciona se um apply anterior deixou alteração parcial na fila. */
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

  try {
    const result = await inspectScheduleFixApply({
      supabase,
      ownerId,
      platform: parsed.data.platform,
      accountId: parsed.data.accountId,
    });

    return NextResponse.json({
      ok: true,
      atomicApplyReady: result.atomicApply.atomicApplyReady,
      dbCredentialMode: result.atomicApply.dbCredentialMode,
      rpcAvailable: result.atomicApply.rpcAvailable,
      applyState: result.applyState,
      warmup: result.warmup,
      preview: {
        safeToApply: result.preview.safeToApply,
        blockReason: result.preview.blockReason,
        totalFuturePosts: result.preview.totalFuturePosts,
        postsToChange: result.preview.postsToChange,
        scheduleMode: result.preview.scheduleMode,
        gradeSource: result.preview.gradeSource,
        currentRange: result.preview.currentRange,
        newRange: result.preview.newRange,
      },
    });
  } catch (err) {
    if (err instanceof ScheduleFixScopeError) {
      return scopeErrorResponse(err);
    }
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Falha na inspeção de apply" },
      { status: 500 },
    );
  }
}
