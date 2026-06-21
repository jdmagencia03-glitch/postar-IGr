import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { OwnerIdSchema } from "@/lib/admin/schemas";
import { requirePlatformAdmin } from "@/lib/admin/gate";
import { formatZodError } from "@/lib/api-errors";
import { buildInstagramVideoUrlAudit } from "@/lib/instagram/video-url-audit";
import { getSessionUserId } from "@/lib/meta/oauth";
import { createAdminClient } from "@/lib/supabase/admin";

const bodySchema = z.object({
  ownerId: OwnerIdSchema,
  accountId: z.string().uuid(),
  limit: z.number().int().min(1).max(50).optional().default(20),
});

/** Auditoria read-only de URLs de vídeo vs Supabase Storage (posts failed/retrying). */
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
    const result = await buildInstagramVideoUrlAudit({
      supabase,
      ownerId: parsed.data.ownerId,
      accountId: parsed.data.accountId,
      limit: parsed.data.limit,
    });

    if (!result.ok) {
      return NextResponse.json(result, { status: 404 });
    }

    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: "audit_failed",
        message: err instanceof Error ? err.message : "Falha na auditoria",
      },
      { status: 500 },
    );
  }
}
