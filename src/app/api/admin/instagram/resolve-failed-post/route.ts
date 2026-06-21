import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { OwnerIdSchema } from "@/lib/admin/schemas";
import { requirePlatformAdmin } from "@/lib/admin/gate";
import { formatZodError } from "@/lib/api-errors";
import { resolveInstagramFailedPost } from "@/lib/instagram/resolve-failed-post";
import { getSessionUserId } from "@/lib/meta/oauth";
import { createAdminClient } from "@/lib/supabase/admin";

const bodySchema = z.object({
  ownerId: OwnerIdSchema,
  accountId: z.string().uuid(),
  postId: z.string().uuid(),
  action: z.enum(["cancel_as_rate_limited_abandoned"]).default("cancel_as_rate_limited_abandoned"),
  confirm: z.boolean().optional().default(false),
});

/** Cancela posts antigos falhados por rate limit (admin). confirm:false → dry-run. */
export async function POST(request: NextRequest) {
  const sessionOwnerId = await getSessionUserId();
  if (!sessionOwnerId) {
    return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const gate = await requirePlatformAdmin(supabase, sessionOwnerId);
  if (!gate.ok) {
    return NextResponse.json({ ok: false, error: "forbidden", message: gate.error }, { status: 403 });
  }

  const raw = await request.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: formatZodError(parsed.error) }, { status: 400 });
  }

  try {
    const result = await resolveInstagramFailedPost({
      supabase,
      ownerId: parsed.data.ownerId,
      accountId: parsed.data.accountId,
      postId: parsed.data.postId,
      action: parsed.data.action,
      confirm: parsed.data.confirm,
    });

    if (!result.ok) {
      const status =
        result.error === "account_not_found" || result.error === "post_not_found" ? 404 : 500;
      return NextResponse.json(result, { status });
    }

    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: "resolve_failed",
        message: err instanceof Error ? err.message : "Falha ao resolver post",
      },
      { status: 500 },
    );
  }
}
