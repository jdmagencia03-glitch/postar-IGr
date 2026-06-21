import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { OwnerIdSchema } from "@/lib/admin/schemas";
import { requirePlatformAdmin } from "@/lib/admin/gate";
import { formatZodError } from "@/lib/api-errors";
import { setInstagramAccountPublishingPaused } from "@/lib/instagram/admin-account";
import { getSessionUserId } from "@/lib/meta/oauth";
import { createAdminClient } from "@/lib/supabase/admin";

const bodySchema = z.object({
  ownerId: OwnerIdSchema,
  accountId: z.string().uuid(),
  publishingPaused: z.boolean().optional().default(true),
  pauseReason: z.string().nullable().optional(),
  confirm: z.boolean().optional().default(false),
});

/** Pausa ou reativa publicação automática de 1 conta Instagram (admin). */
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

  const result = await setInstagramAccountPublishingPaused({
    supabase,
    ownerId: parsed.data.ownerId,
    accountId: parsed.data.accountId,
    publishingPaused: parsed.data.publishingPaused,
    pauseReason: parsed.data.pauseReason,
    confirm: parsed.data.confirm,
  });

  if (!result.ok) {
    const status = result.error === "account_not_found" ? 404 : 500;
    return NextResponse.json(result, { status });
  }

  return NextResponse.json(result);
}
