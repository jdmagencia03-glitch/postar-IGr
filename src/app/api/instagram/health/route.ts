import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/meta/oauth";
import { getOwnerAccountById, getOwnerAccounts, getAccountAccessToken } from "@/lib/accounts";
import { checkInstagramAccountHealth } from "@/lib/meta/instagram";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const ownerId = await getSessionUserId();
  if (!ownerId) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const accountId = request.nextUrl.searchParams.get("account_id");
  const supabase = createAdminClient();

  let account = null;
  if (accountId) {
    account = await getOwnerAccountById(supabase, ownerId, accountId);
  } else {
    const accounts = await getOwnerAccounts(supabase, ownerId);
    account = accounts[0] ?? null;
  }

  const accessToken = account ? getAccountAccessToken(account) : null;

  if (!account || !accessToken) {
    return NextResponse.json({
      account_status: "error",
      status_message: "Nenhuma conta Instagram conectada",
      account_id: null,
      username: null,
      checked_at: new Date().toISOString(),
    });
  }

  const health = await checkInstagramAccountHealth(accessToken, {
    provider: account.auth_provider === "facebook" ? "facebook" : "instagram",
    igUserId: account.ig_user_id,
  });

  return NextResponse.json({
    account_status: health.status,
    status_message: health.message,
    error_code: health.error_code,
    account_id: account.id,
    username: account.ig_username,
    checked_at: new Date().toISOString(),
  });
}
