import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { formatZodError } from "@/lib/api-errors";
import { getSessionUserId } from "@/lib/meta/oauth";
import { createAdminClient } from "@/lib/supabase/admin";
import { validateTikTokConnection } from "@/lib/tiktok/validate";

const bodySchema = z.object({
  account_id: z.string().uuid().optional(),
  id: z.string().uuid().optional(),
});

export async function POST(request: NextRequest) {
  const ownerId = await getSessionUserId();
  if (!ownerId) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
  }

  const accountId = parsed.data.account_id ?? parsed.data.id;
  if (!accountId) {
    return NextResponse.json({ error: "ID da conta obrigatório" }, { status: 400 });
  }

  const supabase = createAdminClient();

  try {
    const result = await validateTikTokConnection(supabase, ownerId, accountId, {
      persist: true,
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha na validação TikTok" },
      { status: 500 },
    );
  }
}
