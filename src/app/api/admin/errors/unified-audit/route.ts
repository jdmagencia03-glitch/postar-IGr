import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePlatformAdmin } from "@/lib/admin/gate";
import { formatZodError } from "@/lib/api-errors";
import { getSessionUserId } from "@/lib/meta/oauth";
import { buildUnifiedErrorAudit } from "@/lib/operations/unified-error-audit";
import { createAdminClient } from "@/lib/supabase/admin";

const bodySchema = z.object({
  scope: z.literal("all").optional().default("all"),
  includeAccounts: z.boolean().optional().default(true),
  includePosts: z.boolean().optional().default(true),
  includeDiagnostics: z.boolean().optional().default(true),
  simulatePanelFilters: z
    .object({
      centralErrorsAccountId: z.string().uuid().optional(),
      centralErrorsPlatform: z.enum(["all", "instagram", "tiktok"]).optional(),
      operationsAccountId: z.string().uuid().optional(),
      operationsPlatform: z.enum(["all", "instagram", "tiktok"]).optional(),
      adminAuditScope: z.string().optional(),
    })
    .optional(),
});

/** Auditoria unificada de erros/contas — somente leitura. */
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

  const audit = await buildUnifiedErrorAudit(supabase, ownerId, {
    scope: parsed.data.scope,
    includeAccounts: parsed.data.includeAccounts,
    includePosts: parsed.data.includePosts,
    includeDiagnostics: parsed.data.includeDiagnostics,
    simulatePanelFilters: parsed.data.simulatePanelFilters,
  });

  return NextResponse.json(audit);
}
