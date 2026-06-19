import { formatZodError } from "@/lib/api-errors";
import { getOwnerAccountById } from "@/lib/accounts";
import { getSessionUserId } from "@/lib/meta/oauth";
import { getOwnerTikTokAccountById } from "@/lib/tiktok/accounts";
import { clearAccountUploadedVideos, countAccountUploadedVideos } from "@/lib/upload/batches";
import { createAdminClient } from "@/lib/supabase/admin";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const clearSchema = z.object({
  platform: z.enum(["instagram", "tiktok"]),
  account_id: z.string().uuid(),
});

export async function POST(request: NextRequest) {
  const ownerId = await getSessionUserId();
  if (!ownerId) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const body = await request.json();
  const parsed = clearSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { platform, account_id: accountId } = parsed.data;

  if (platform === "tiktok") {
    const account = await getOwnerTikTokAccountById(supabase, ownerId, accountId);
    if (!account) {
      return NextResponse.json({ error: "Conta TikTok não encontrada" }, { status: 404 });
    }
  } else {
    const account = await getOwnerAccountById(supabase, ownerId, accountId);
    if (!account) {
      return NextResponse.json({ error: "Conta Instagram não encontrada" }, { status: 404 });
    }
  }

  try {
    const before = await countAccountUploadedVideos(supabase, ownerId, platform, accountId);
    if (before.files === 0) {
      return NextResponse.json({
        batches_cleared: 0,
        files_cleared: 0,
        message: "Nenhum vídeo enviado encontrado para esta conta.",
      });
    }

    const result = await clearAccountUploadedVideos(supabase, ownerId, platform, accountId);

    return NextResponse.json({
      ...result,
      message: `${result.filesCleared} vídeo(s) removidos da conta selecionada.`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao apagar vídeos";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
