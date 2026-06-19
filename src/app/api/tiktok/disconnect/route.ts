import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { formatZodError } from "@/lib/api-errors";
import { getSessionUserId } from "@/lib/meta/oauth";
import { createAdminClient } from "@/lib/supabase/admin";
import { logSecurityEvent } from "@/lib/security/audit";
import {
  getOwnerTikTokAccountById,
  getValidTikTokAccessToken,
} from "@/lib/tiktok/accounts";
import { decryptTikTokAccessToken } from "@/lib/security/tokens";
import { revokeAccessToken } from "@/lib/tiktok/oauth";

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
  const account = await getOwnerTikTokAccountById(supabase, ownerId, accountId);

  if (!account) {
    return NextResponse.json({ error: "Conta TikTok não encontrada" }, { status: 404 });
  }

  try {
    const accessToken =
      decryptTikTokAccessToken(account.access_token) ??
      (await getValidTikTokAccessToken(supabase, account).catch(() => null));

    if (accessToken) {
      await revokeAccessToken(accessToken).catch(() => {
        // Token pode já estar inválido — seguimos com remoção local
      });
    }
  } catch {
    // Revogação opcional; desconexão local sempre prossegue
  }

  const { error } = await supabase
    .from("tiktok_accounts")
    .delete()
    .eq("id", accountId)
    .eq("owner_id", ownerId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await logSecurityEvent({
    ownerId,
    eventType: "account_deleted",
    resourceType: "tiktok_account",
    resourceId: accountId,
    metadata: { platform: "tiktok", username: account.username, disconnected: true },
  });

  return NextResponse.json({ success: true });
}
