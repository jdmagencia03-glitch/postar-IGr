import { NextRequest, NextResponse } from "next/server";
import { getAccountAccessToken, getOwnerAccountById } from "@/lib/accounts";
import { fetchInstagramProfileSnapshot } from "@/lib/meta/instagram-profile";
import { getSessionUserId } from "@/lib/meta/oauth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getOwnerTikTokAccountById } from "@/lib/tiktok/accounts";
import { queryCreatorInfoForAccount } from "@/lib/tiktok/creator";

export async function POST(request: NextRequest) {
  const ownerId = await getSessionUserId();
  if (!ownerId) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  let accountId: string | undefined;
  try {
    const body = (await request.json()) as { accountId?: string };
    accountId = body.accountId;
  } catch {
    accountId = undefined;
  }

  if (!accountId) {
    return NextResponse.json({ error: "Selecione uma conta antes de importar." }, { status: 400 });
  }

  const supabase = createAdminClient();
  const igAccount = await getOwnerAccountById(supabase, ownerId, accountId);
  const accessToken = igAccount ? getAccountAccessToken(igAccount) : null;

  if (accessToken && igAccount?.ig_user_id) {
    try {
      const snapshot = await fetchInstagramProfileSnapshot({
        accessToken,
        igUserId: igAccount.ig_user_id,
        provider: igAccount.auth_provider ?? "instagram",
        mediaLimit: 12,
      });

      return NextResponse.json({ snapshot, platform: "instagram" });
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Não foi possível importar o perfil." },
        { status: 502 },
      );
    }
  }

  const tiktokAccount = await getOwnerTikTokAccountById(supabase, ownerId, accountId);
  if (!tiktokAccount) {
    return NextResponse.json({ error: "Conta não encontrada." }, { status: 404 });
  }

  try {
    const creator = await queryCreatorInfoForAccount(supabase, tiktokAccount).catch(() => null);
    const username =
      creator?.creator_username ??
      tiktokAccount.creator_username ??
      tiktokAccount.username ??
      "";
    const name = creator?.creator_nickname ?? tiktokAccount.display_name ?? "";

    return NextResponse.json({
      platform: "tiktok",
      snapshot: {
        username,
        name,
        biography: "",
        captions: [],
        hashtags: [],
        themes: [],
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Não foi possível importar o perfil TikTok." },
      { status: 502 },
    );
  }
}
