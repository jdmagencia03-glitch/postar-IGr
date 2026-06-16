import { NextRequest, NextResponse } from "next/server";
import { resolveImportAccount } from "@/lib/ai/resolve-import-account";
import { fetchInstagramProfileSnapshot } from "@/lib/meta/instagram-profile";
import { getSessionUserId } from "@/lib/meta/oauth";

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

  const account = await resolveImportAccount(ownerId, accountId);

  if (!account?.page_access_token || !account.ig_user_id) {
    return NextResponse.json(
      { error: "Conecte uma conta do Instagram em Contas antes de importar." },
      { status: 400 },
    );
  }

  try {
    const snapshot = await fetchInstagramProfileSnapshot({
      accessToken: account.page_access_token,
      igUserId: account.ig_user_id,
      provider: account.auth_provider ?? "instagram",
      mediaLimit: 5,
    });

    return NextResponse.json({
      captions: snapshot.captions.slice(0, 5),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Não foi possível importar legendas." },
      { status: 502 },
    );
  }
}
