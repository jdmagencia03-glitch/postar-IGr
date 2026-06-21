import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { OptionalOwnerIdSchema } from "@/lib/admin/schemas";
import { requirePlatformAdmin } from "@/lib/admin/gate";
import { formatZodError } from "@/lib/api-errors";
import { buildMediaIntegrityAudit } from "@/lib/media/integrity-audit";
import { getSessionUserId } from "@/lib/meta/oauth";
import { createAdminClient } from "@/lib/supabase/admin";

const bodySchema = z.object({
  scope: z.enum(["platform", "owner", "account"]).default("platform"),
  ownerId: OptionalOwnerIdSchema,
  accountId: z.string().uuid().nullable().optional(),
  includePending: z.boolean().optional().default(true),
  includeFailed: z.boolean().optional().default(true),
  includePublished: z.boolean().optional().default(false),
});

/** Auditoria preventiva de integridade de mídia (admin, read-only). */
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

  if (parsed.data.scope === "account" && (!parsed.data.ownerId || !parsed.data.accountId)) {
    return NextResponse.json(
      { ok: false, error: "ownerId and accountId required for scope=account" },
      { status: 400 },
    );
  }

  if (parsed.data.scope === "owner" && !parsed.data.ownerId) {
    return NextResponse.json({ ok: false, error: "ownerId required for scope=owner" }, { status: 400 });
  }

  try {
    const result = await buildMediaIntegrityAudit({
      supabase,
      scope: parsed.data.scope,
      ownerId: parsed.data.ownerId ?? null,
      accountId: parsed.data.accountId ?? null,
      includePending: parsed.data.includePending,
      includeFailed: parsed.data.includeFailed,
      includePublished: parsed.data.includePublished,
    });

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
