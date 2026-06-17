import { NextResponse } from "next/server";
import { getAccountAccessToken, getOwnerAccountById } from "@/lib/accounts";
import { fetchRecentMediaIds } from "@/lib/meta/comment-dm-api";
import { getSessionUserId } from "@/lib/meta/oauth";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(request: Request) {
  const ownerId = await getSessionUserId();
  if (!ownerId) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const accountId = new URL(request.url).searchParams.get("account_id");
  if (!accountId) {
    return NextResponse.json({ error: "account_id obrigatório" }, { status: 400 });
  }

  const supabase = createAdminClient();
  const account = await getOwnerAccountById(supabase, ownerId, accountId);

  if (!account) {
    return NextResponse.json({ error: "Conta não encontrada" }, { status: 404 });
  }

  const token = getAccountAccessToken(account);
  if (!token) {
    return NextResponse.json({ error: "Token indisponível — reconecte a conta" }, { status: 400 });
  }

  try {
    const provider = account.auth_provider === "facebook" ? "facebook" : "instagram";
    const mediaIds = await fetchRecentMediaIds({
      igUserId: account.ig_user_id,
      token,
      provider,
      limit: 25,
    });

    const graph = provider === "facebook" ? "https://graph.facebook.com/v21.0" : "https://graph.instagram.com/v21.0";
    const media = await Promise.all(
      mediaIds.map(async (id) => {
        const res = await fetch(
          `${graph}/${id}?fields=id,caption,media_type,permalink,timestamp,thumbnail_url&access_token=${encodeURIComponent(token)}`,
          { cache: "no-store" },
        );
        const data = await res.json();
        if (!res.ok) return { id, caption: null, media_type: null, permalink: null, timestamp: null };
        return data as {
          id: string;
          caption?: string;
          media_type?: string;
          permalink?: string;
          timestamp?: string;
          thumbnail_url?: string;
        };
      }),
    );

    return NextResponse.json(media);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Falha ao listar mídias" },
      { status: 500 },
    );
  }
}
