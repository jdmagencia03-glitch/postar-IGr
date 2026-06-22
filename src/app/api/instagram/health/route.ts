import { NextRequest, NextResponse } from "next/server";
import { dbTimeoutJsonResponse } from "@/lib/api/db-resilience";
import { getSessionUserId } from "@/lib/meta/oauth";
import { getOwnerAccountById, getOwnerAccounts, getAccountAccessToken } from "@/lib/accounts";
import { checkInstagramAccountHealth } from "@/lib/meta/instagram";
import { createAdminClient } from "@/lib/supabase/admin";
import { withTimeout, withTimeoutOrNull, DB_ROUTE_TIMEOUT_MS } from "@/lib/with-timeout";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const ownerId = await getSessionUserId();
  if (!ownerId) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const accountId = request.nextUrl.searchParams.get("account_id");
  const supabase = createAdminClient();

  const account = await withTimeoutOrNull(
    (async () => {
      if (accountId) {
        return getOwnerAccountById(supabase, ownerId, accountId);
      }
      const accounts = await getOwnerAccounts(supabase, ownerId);
      return accounts[0] ?? null;
    })(),
    DB_ROUTE_TIMEOUT_MS,
    "api-instagram-health-account",
  );

  if (account === null) {
    return dbTimeoutJsonResponse({
      account_status: "error",
      status_message: "Banco temporariamente lento",
      account_id: null,
      username: null,
      checked_at: new Date().toISOString(),
    });
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

  const health = await withTimeout(
    checkInstagramAccountHealth(accessToken, {
      provider: account.auth_provider === "facebook" ? "facebook" : "instagram",
      igUserId: account.ig_user_id,
    }),
    DB_ROUTE_TIMEOUT_MS,
    {
      status: "error" as const,
      message: "Verificação indisponível no momento",
      error_code: undefined,
    },
    "api-instagram-health-meta",
  );

  return NextResponse.json({
    account_status: health.status,
    status_message: health.message,
    error_code: health.error_code,
    account_id: account.id,
    username: account.ig_username,
    checked_at: new Date().toISOString(),
  });
}
