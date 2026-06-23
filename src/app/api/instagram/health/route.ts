import { NextRequest, NextResponse } from "next/server";
import {
  apiSessionErrorResponse,
  requireApiSessionSafe,
} from "@/lib/auth/api-session";
import { dbTimeoutJsonResponse } from "@/lib/api/db-resilience";
import { getOwnerAccountById, getOwnerAccounts, getAccountAccessToken } from "@/lib/accounts";
import { checkInstagramAccountHealth } from "@/lib/meta/instagram";
import { createAdminClient } from "@/lib/supabase/admin";
import { withHardTimeout, DB_ROUTE_TIMEOUT_MS } from "@/lib/with-timeout";

export const dynamic = "force-dynamic";

const ROUTE = "/api/instagram/health";

const HEALTH_TIMEOUT_FALLBACK = {
  account_status: "error" as const,
  status_message: "Verificação indisponível no momento",
  account_id: null as string | null,
  username: null as string | null,
  checked_at: "",
};

export async function GET(request: NextRequest) {
  try {
    const session = await requireApiSessionSafe(ROUTE);
    if (!session.ok) {
      return apiSessionErrorResponse(session, HEALTH_TIMEOUT_FALLBACK);
    }

    const ownerId = session.userId;
    const accountId = request.nextUrl.searchParams.get("account_id");
    const supabase = createAdminClient();

    const account = await withHardTimeout(
      (async () => {
        if (accountId) {
          return getOwnerAccountById(supabase, ownerId, accountId);
        }
        const accounts = await getOwnerAccounts(supabase, ownerId);
        return accounts[0] ?? null;
      })(),
      DB_ROUTE_TIMEOUT_MS,
      null,
      "api-instagram-health-account",
    );

    if (account === null) {
      return dbTimeoutJsonResponse({
        ...HEALTH_TIMEOUT_FALLBACK,
        status_message: "Banco temporariamente lento",
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

    const health = await withHardTimeout(
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
  } catch (error) {
    console.error("[api-handler-failed]", { route: ROUTE, error });
    return NextResponse.json(
      {
        ok: false,
        error: "server_error",
        message: "Erro temporário no servidor.",
        account_status: "error",
        status_message: "Erro temporário no servidor.",
        account_id: null,
        username: null,
        checked_at: new Date().toISOString(),
      },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
