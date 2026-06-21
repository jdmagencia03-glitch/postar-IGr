import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { OwnerIdSchema } from "@/lib/admin/schemas";
import { requirePlatformAdmin } from "@/lib/admin/gate";
import { formatZodError } from "@/lib/api-errors";
import { buildInstagramQueueResetPlan } from "@/lib/media/reset-queue";
import { getSessionUserId } from "@/lib/meta/oauth";
import { createAdminClient } from "@/lib/supabase/admin";

const bodySchema = z.object({
  ownerId: OwnerIdSchema,
  accountId: z.string().uuid(),
  mode: z.enum(["cancel_all_unpublished"]).default("cancel_all_unpublished"),
  confirm: z.boolean().optional().default(false),
});

/** Cancela fila não publicada de 1 conta Instagram (admin) com backup JSON. */
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
    const result = await buildInstagramQueueResetPlan({
      supabase,
      ownerId: parsed.data.ownerId,
      accountId: parsed.data.accountId,
      mode: parsed.data.mode,
      confirm: parsed.data.confirm,
    });

    if (!result.ok) {
      const status = result.error === "account_not_found" ? 404 : 500;
      return NextResponse.json(result, { status });
    }

    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: "reset_failed",
        message: err instanceof Error ? err.message : "Falha ao resetar fila",
      },
      { status: 500 },
    );
  }
}
