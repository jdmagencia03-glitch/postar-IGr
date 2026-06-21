import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePlatformAdmin } from "@/lib/admin/gate";
import { formatZodError } from "@/lib/api-errors";
import { getSessionUserId } from "@/lib/meta/oauth";
import { ignoreStoredFinding } from "@/lib/operations/platform-audit/repository";
import { createAdminClient } from "@/lib/supabase/admin";

const bodySchema = z.object({
  fingerprint: z.string().min(3),
});

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

  try {
    await ignoreStoredFinding({
      supabase,
      ownerId,
      fingerprint: parsed.data.fingerprint,
      ignoredBy: ownerId,
    });

    console.info("[audit-ignore]", { fingerprint: parsed.data.fingerprint });

    return NextResponse.json({ ignored: true, fingerprint: parsed.data.fingerprint });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Falha ao ignorar achado" },
      { status: 500 },
    );
  }
}
