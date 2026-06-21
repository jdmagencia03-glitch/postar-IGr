import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { OwnerIdSchema } from "@/lib/admin/schemas";
import { requirePlatformAdmin } from "@/lib/admin/gate";
import { formatZodError } from "@/lib/api-errors";
import { resolveInstagramDuplicateGuard } from "@/lib/instagram/resolve-duplicate-guard";
import { getSessionUserId } from "@/lib/meta/oauth";
import { createAdminClient } from "@/lib/supabase/admin";

const bodySchema = z.object({
  ownerId: OwnerIdSchema,
  accountId: z.string().uuid(),
  postId: z.string().uuid(),
  action: z
    .enum(["auto", "mark_as_published", "cancel_as_duplicate", "manual_review"])
    .default("auto"),
  confirm: z.boolean().optional().default(false),
});

/** Resolve posts bloqueados pelo duplicate guard (admin). confirm:false → dry-run. */
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
    const result = await resolveInstagramDuplicateGuard({
      supabase,
      ownerId: parsed.data.ownerId,
      accountId: parsed.data.accountId,
      postId: parsed.data.postId,
      action: parsed.data.action,
      confirm: parsed.data.confirm,
    });

    if (!result.ok) {
      const status =
        result.error === "account_not_found" || result.error === "post_not_found"
          ? 404
          : result.error === "manual_review_required"
            ? 409
            : 500;
      return NextResponse.json(result, { status });
    }

    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: "resolve_failed",
        message: err instanceof Error ? err.message : "Falha ao resolver duplicate guard",
      },
      { status: 500 },
    );
  }
}
