import { NextRequest, NextResponse } from "next/server";
import { formatZodError } from "@/lib/api-errors";
import { getSessionUserId } from "@/lib/meta/oauth";
import { validateAccountPermissions } from "@/lib/operations/validate-permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { z } from "zod";

const bodySchema = z.object({
  platform: z.enum(["instagram", "tiktok"]),
  test_type: z.enum(["permissions", "reel", "story", "tiktok_video"]).default("permissions"),
  confirm_real_publish: z.boolean().optional(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ownerId = await getSessionUserId();
  if (!ownerId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const { id } = await params;
  const body = await request.json();
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
  }

  const supabase = createAdminClient();
  const validation = await validateAccountPermissions(
    supabase,
    ownerId,
    id,
    parsed.data.platform,
  );

  const wantsReal =
    parsed.data.test_type !== "permissions" && parsed.data.confirm_real_publish === true;

  if (parsed.data.test_type !== "permissions" && !wantsReal) {
    return NextResponse.json({
      mode: "permissions_only",
      warning:
        "Publicação real de teste exige confirmação explícita. Por segurança, apenas permissões foram validadas.",
      validation,
      success: validation.overall !== "error",
      tested_at: new Date().toISOString(),
    });
  }

  if (wantsReal) {
    return NextResponse.json({
      mode: "real_publish_not_implemented",
      warning:
        "Publicação real de teste ainda não está habilitada. Use a validação de permissões antes de agendar em massa.",
      validation,
      success: false,
      tested_at: new Date().toISOString(),
    });
  }

  await supabase.from("security_audit_logs").insert({
    owner_id: ownerId,
    event_type: "account_publish_test",
    resource_type: "account",
    resource_id: id,
    metadata: {
      platform: parsed.data.platform,
      test_type: parsed.data.test_type,
      overall: validation.overall,
      summary: validation.summary,
    },
  });

  return NextResponse.json({
    mode: "permissions",
    validation,
    success: validation.overall !== "error",
    message: validation.summary,
    tested_at: new Date().toISOString(),
  });
}
