import { NextResponse } from "next/server";
import {
  getOwnerTikTokAccounts,
  getOwnerTikTokAccountById,
  mapTikTokAccountResponse,
} from "@/lib/tiktok/accounts";
import { getSessionUserId } from "@/lib/meta/oauth";
import { createAdminClient } from "@/lib/supabase/admin";
import { logSecurityEvent } from "@/lib/security/audit";

export async function GET() {
  const ownerId = await getSessionUserId();
  if (!ownerId) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const accounts = await getOwnerTikTokAccounts(supabase, ownerId);

  return NextResponse.json(accounts.map(mapTikTokAccountResponse));
}

export async function DELETE(request: Request) {
  const ownerId = await getSessionUserId();
  if (!ownerId) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const accountId = new URL(request.url).searchParams.get("id");
  if (!accountId) {
    return NextResponse.json({ error: "ID da conta obrigatório" }, { status: 400 });
  }

  const supabase = createAdminClient();
  const account = await getOwnerTikTokAccountById(supabase, ownerId, accountId);

  if (!account) {
    return NextResponse.json({ error: "Conta TikTok não encontrada" }, { status: 404 });
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
    metadata: { platform: "tiktok", username: account.username },
  });

  return NextResponse.json({ success: true });
}
