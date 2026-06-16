import { formatZodError } from "@/lib/api-errors";
import { formatCaptionsForOwner } from "@/lib/ai/format-captions-bulk";
import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/meta/oauth";
import { createAdminClient } from "@/lib/supabase/admin";
import { z } from "zod";

const bodySchema = z.object({
  post_ids: z.array(z.string().uuid()).optional(),
  account_id: z.string().uuid().optional(),
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

  const supabase = createAdminClient();
  const result = await formatCaptionsForOwner(supabase, ownerId, {
    postIds: parsed.data.post_ids,
    accountId: parsed.data.account_id,
  });

  return NextResponse.json({
    ok: result.failed === 0,
    ...result,
    message:
      result.updated > 0
        ? `${result.updated} legenda(s) reformatada(s)${result.unchanged ? ` · ${result.unchanged} já estavam corretas` : ""}`
        : result.total > 0
          ? `Nenhuma legenda precisou de ajuste (${result.unchanged} já formatadas)`
          : "Nenhum post pendente ou com falha encontrado para formatar",
  });
}
