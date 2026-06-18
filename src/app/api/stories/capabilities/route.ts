import { NextRequest, NextResponse } from "next/server";
import { getOwnerAccountById } from "@/lib/accounts";
import { checkInstagramStoryPublishCapability } from "@/lib/meta/instagram-stories";
import { getSessionUserId } from "@/lib/meta/oauth";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptPageAccessToken } from "@/lib/security/tokens";

export async function GET(request: NextRequest) {
  const ownerId = await getSessionUserId();
  if (!ownerId) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const accountId = request.nextUrl.searchParams.get("accountId");
  if (!accountId) {
    return NextResponse.json({ error: "Informe accountId" }, { status: 400 });
  }

  const supabase = createAdminClient();
  const account = await getOwnerAccountById(supabase, ownerId, accountId);
  if (!account) {
    return NextResponse.json({ error: "Conta não encontrada" }, { status: 404 });
  }

  const token = decryptPageAccessToken(account.page_access_token);
  if (!token) {
    return NextResponse.json({ error: "Token da conta indisponível" }, { status: 400 });
  }

  const capability = await checkInstagramStoryPublishCapability({
    accessToken: token,
    provider: account.auth_provider ?? "instagram",
  });

  return NextResponse.json({
    accountId,
    username: account.ig_username,
    ...capability,
  });
}
