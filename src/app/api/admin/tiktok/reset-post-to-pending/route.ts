import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePlatformAdmin } from "@/lib/admin/gate";
import { formatZodError } from "@/lib/api-errors";
import { getSessionUserId } from "@/lib/meta/oauth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTikTokPostAdminStatus, resetTikTokPostToPending } from "@/lib/tiktok/post-admin";

const bodySchema = z.object({
  postId: z.string().uuid(),
  accountId: z.string().uuid().optional(),
  confirm: z.boolean().optional().default(false),
});

/**
 * Volta post TikTok failed/retrying para pending (admin).
 * Não publica. Não altera scheduled_at.
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

  const current = await getTikTokPostAdminStatus(
    supabase,
    parsed.data.postId,
    parsed.data.accountId,
  );

  if (!current) {
    return NextResponse.json({ ok: false, error: "post_not_found" }, { status: 404 });
  }

  if (!parsed.data.confirm) {
    return NextResponse.json({
      ok: true,
      dryRun: true,
      wouldResetToPending: current.canResetToPending,
      post: current,
    });
  }

  try {
    const result = await resetTikTokPostToPending(
      supabase,
      parsed.data.postId,
      parsed.data.accountId,
    );

    return NextResponse.json({
      ok: true,
      reset: true,
      postId: parsed.data.postId,
      before: result.before,
      after: result.after,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao resetar post";
    return NextResponse.json(
      {
        ok: false,
        error: "reset_failed",
        message,
        post: current,
      },
      { status: 409 },
    );
  }
}
