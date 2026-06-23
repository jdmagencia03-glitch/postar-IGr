import { NextResponse } from "next/server";
import {
  apiSessionErrorResponse,
  requireApiSessionSafe,
} from "@/lib/auth/api-session";
import { dbTimeoutJsonResponse } from "@/lib/api/db-resilience";
import {
  getOwnerTikTokAccounts,
  getOwnerTikTokAccountById,
  mapTikTokAccountResponse,
} from "@/lib/tiktok/accounts";
import { createAdminClient } from "@/lib/supabase/admin";
import { logSecurityEvent } from "@/lib/security/audit";
import { withHardTimeout, DB_ROUTE_TIMEOUT_MS } from "@/lib/with-timeout";

const ROUTE = "/api/tiktok/accounts";

export async function GET() {
  try {
    const session = await requireApiSessionSafe(ROUTE);
    if (!session.ok) {
      return apiSessionErrorResponse(session, []);
    }

    const supabase = createAdminClient();
    const accounts = await withHardTimeout(
      getOwnerTikTokAccounts(supabase, session.userId),
      DB_ROUTE_TIMEOUT_MS,
      null,
      "api-tiktok-accounts-list",
    );

    if (accounts === null) {
      return dbTimeoutJsonResponse([]);
    }

    return NextResponse.json(accounts.map(mapTikTokAccountResponse));
  } catch (error) {
    console.error("[api-handler-failed]", { route: ROUTE, error });
    return NextResponse.json(
      {
        ok: false,
        error: "server_error",
        message: "Erro temporário no servidor.",
        data: [],
      },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const session = await requireApiSessionSafe(ROUTE);
    if (!session.ok) {
      return apiSessionErrorResponse(session, []);
    }

    const ownerId = session.userId;
    const accountId = new URL(request.url).searchParams.get("id");
    if (!accountId) {
      return NextResponse.json({ error: "ID da conta obrigatório" }, { status: 400 });
    }

    const supabase = createAdminClient();
    const account = await getOwnerTikTokAccountById(supabase, ownerId, accountId);

    if (!account) {
      return NextResponse.json({ error: "Conta TikTok não encontrada" }, { status: 404 });
    }

    try {
      const { decryptTikTokAccessToken } = await import("@/lib/security/tokens");
      const { revokeAccessToken } = await import("@/lib/tiktok/oauth");
      const { getValidTikTokAccessToken } = await import("@/lib/tiktok/accounts");

      const accessToken =
        decryptTikTokAccessToken(account.access_token) ??
        (await getValidTikTokAccessToken(supabase, account).catch(() => null));

      if (accessToken) {
        await revokeAccessToken(accessToken).catch(() => undefined);
      }
    } catch {
      // Prossegue com remoção local
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
  } catch (error) {
    console.error("[api-handler-failed]", { route: ROUTE, error });
    return NextResponse.json(
      {
        ok: false,
        error: "server_error",
        message: "Erro temporário no servidor.",
        data: [],
      },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
