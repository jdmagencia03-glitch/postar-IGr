import { NextRequest, NextResponse } from "next/server";
import { getOwnerAccountById } from "@/lib/accounts";
import { formatZodError } from "@/lib/api-errors";
import { getSessionUserId } from "@/lib/meta/oauth";
import { getOwnerTikTokAccountById } from "@/lib/tiktok/accounts";
import { createAdminClient } from "@/lib/supabase/admin";
import { z } from "zod";

const bodySchema = z.object({
  platform: z.enum(["instagram", "tiktok"]),
  paused: z.boolean(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ownerId = await getSessionUserId();
  if (!ownerId) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json();
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
  }

  const supabase = createAdminClient();

  if (parsed.data.platform === "tiktok") {
    const account = await getOwnerTikTokAccountById(supabase, ownerId, id);
    if (!account) {
      return NextResponse.json({ error: "Conta TikTok não encontrada" }, { status: 404 });
    }

    const { error } = await supabase
      .from("tiktok_accounts")
      .update({ publishing_paused: parsed.data.paused, updated_at: new Date().toISOString() })
      .eq("id", id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  } else {
    const account = await getOwnerAccountById(supabase, ownerId, id);
    if (!account) {
      return NextResponse.json({ error: "Conta Instagram não encontrada" }, { status: 404 });
    }

    const { error } = await supabase
      .from("instagram_accounts")
      .update({ publishing_paused: parsed.data.paused, updated_at: new Date().toISOString() })
      .eq("id", id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  return NextResponse.json({
    paused: parsed.data.paused,
    message: parsed.data.paused
      ? "Publicações automáticas pausadas para esta conta."
      : "Publicações automáticas retomadas.",
  });
}
