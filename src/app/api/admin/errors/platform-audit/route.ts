import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePlatformAdmin } from "@/lib/admin/gate";
import { formatZodError } from "@/lib/api-errors";
import { getSessionUserId } from "@/lib/meta/oauth";
import { buildPlatformErrorAudit } from "@/lib/operations/platform-error-audit";
import { createAdminClient } from "@/lib/supabase/admin";

const bodySchema = z.object({
  scope: z.literal("platform").optional().default("platform"),
  accountSearch: z.string().optional(),
  includeAccounts: z.boolean().optional().default(true),
  includePosts: z.boolean().optional().default(true),
  includeOperationalErrors: z.boolean().optional().default(true),
  includeOwners: z.boolean().optional().default(true),
});

/** Auditoria platform-wide de contas/erros — somente leitura, todos os owner_id. */
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

  const audit = await buildPlatformErrorAudit(supabase, {
    scope: parsed.data.scope,
    accountSearch: parsed.data.accountSearch,
    includeAccounts: parsed.data.includeAccounts,
    includePosts: parsed.data.includePosts,
    includeOperationalErrors: parsed.data.includeOperationalErrors,
    includeOwners: parsed.data.includeOwners,
    sessionOwnerId,
  });

  return NextResponse.json(audit);
}
