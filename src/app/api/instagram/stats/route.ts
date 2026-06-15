import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/meta/oauth";
import { getOwnerAccountById, getOwnerAccounts } from "@/lib/accounts";
import {
  checkInstagramAccountHealth,
  getInstagramAccountStats,
} from "@/lib/meta/instagram";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

async function resolveAccount(ownerId: string, accountId?: string | null) {
  const supabase = createAdminClient();

  if (accountId) {
    const account = await getOwnerAccountById(supabase, ownerId, accountId);
    return { supabase, account };
  }

  const accounts = await getOwnerAccounts(supabase, ownerId);
  return { supabase, account: accounts[0] ?? null };
}

export async function GET(request: NextRequest) {
  const ownerId = await getSessionUserId();
  if (!ownerId) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const accountId = request.nextUrl.searchParams.get("account_id");
  const { supabase, account } = await resolveAccount(ownerId, accountId);

  if (!account?.page_access_token) {
    return NextResponse.json({
      account_status: "error",
      status_message: "Nenhuma conta Instagram conectada",
      account_id: null,
      username: null,
      checked_at: new Date().toISOString(),
    });
  }

  const health = await checkInstagramAccountHealth(account.page_access_token, {
    provider: account.auth_provider === "facebook" ? "facebook" : "instagram",
    igUserId: account.ig_user_id,
  });

  if (health.status === "error") {
    return NextResponse.json({
      account_status: "error",
      status_message: health.message,
      error_code: health.error_code,
      account_id: account.id,
      username: account.ig_username,
      profile_picture_url: account.profile_picture_url,
      checked_at: new Date().toISOString(),
    });
  }

  try {
    const stats = await getInstagramAccountStats(account.page_access_token, {
      provider: account.auth_provider === "facebook" ? "facebook" : "instagram",
      igUserId: account.ig_user_id,
    });

    await supabase
      .from("instagram_accounts")
      .update({
        ig_username: stats.username ?? account.ig_username,
        profile_picture_url: stats.profile_picture_url ?? account.profile_picture_url,
        updated_at: new Date().toISOString(),
      })
      .eq("id", account.id);

    return NextResponse.json({
      account_status: "active",
      status_message: health.message,
      account_id: account.id,
      ...stats,
      fetched_at: new Date().toISOString(),
      checked_at: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao buscar Instagram";

    return NextResponse.json({
      account_status: "error",
      status_message: message,
      account_id: account.id,
      username: account.ig_username,
      profile_picture_url: account.profile_picture_url,
      followers_count: 0,
      follows_count: 0,
      media_count: 0,
      fetched_at: new Date().toISOString(),
      checked_at: new Date().toISOString(),
    });
  }
}
