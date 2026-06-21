import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePlatformAdmin } from "@/lib/admin/gate";
import { formatZodError } from "@/lib/api-errors";
import { getSessionUserId } from "@/lib/meta/oauth";
import { createAdminClient } from "@/lib/supabase/admin";

const bodySchema = z.object({
  findingId: z.string(),
  action: z.string(),
  apply: z.boolean().optional().default(false),
  dryRun: z.literal(true).optional().default(true),
  platform: z.enum(["instagram", "tiktok"]).optional(),
  accountId: z.string().uuid().optional(),
});

/** Correções automáticas exigem confirmação explícita — v1 retorna apenas preview. */
export async function POST(request: NextRequest) {
  const ownerId = await getSessionUserId();
  if (!ownerId) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const gate = await requirePlatformAdmin(supabase, ownerId);
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
  }

  if (parsed.data.apply) {
    console.info("[audit-fix-skipped]", {
      findingId: parsed.data.findingId,
      reason: "apply_requires_confirmation_v2",
    });
    return NextResponse.json(
      {
        applied: false,
        dryRun: true,
        message:
          "Correção automática ainda não habilitada. Use os endpoints específicos (fix-duplicate-slots, schedule-jobs) com preview manual.",
        findingId: parsed.data.findingId,
      },
      { status: 501 },
    );
  }

  console.info("[audit-fix-preview]", {
    findingId: parsed.data.findingId,
    action: parsed.data.action,
    platform: parsed.data.platform,
    accountId: parsed.data.accountId,
  });

  return NextResponse.json({
    dryRun: true,
    preview: true,
    findingId: parsed.data.findingId,
    message: "Preview registrado. Nenhuma alteração foi aplicada.",
  });
}
