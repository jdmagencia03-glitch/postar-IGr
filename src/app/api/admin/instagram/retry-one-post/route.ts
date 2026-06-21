import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { OwnerIdSchema } from "@/lib/admin/schemas";
import { requirePlatformAdmin } from "@/lib/admin/gate";
import { formatZodError } from "@/lib/api-errors";
import { buildInstagramRetryOnePostPlan } from "@/lib/instagram/retry-one-post";
import { getSessionUserId } from "@/lib/meta/oauth";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 300;

const bodySchema = z.object({
  ownerId: OwnerIdSchema,
  accountId: z.string().uuid(),
  postId: z.string().uuid(),
  confirm: z.boolean().optional().default(false),
  forceNewContainer: z.boolean().optional().default(true),
});

/** Retry seguro de exatamente 1 post Instagram (admin). confirm:false → dry-run. */
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

  const result = await buildInstagramRetryOnePostPlan({
    supabase,
    ownerId: parsed.data.ownerId,
    accountId: parsed.data.accountId,
    postId: parsed.data.postId,
    confirm: parsed.data.confirm,
    forceNewContainer: parsed.data.forceNewContainer,
  });

  if (!result.ok) {
    const status =
      result.error === "account_not_found" || result.error === "post_not_found"
        ? 404
        : result.error === "cannot_retry" || result.error === "unsafe_to_retry"
          ? 409
          : result.error === "claim_failed"
            ? 409
            : result.error === "publish_failed"
              ? 502
              : 500;
    return NextResponse.json(result, { status });
  }

  return NextResponse.json(result);
}
