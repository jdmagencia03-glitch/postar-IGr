import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/meta/oauth";
import { getOwnerAccountById, getOwnerAccounts } from "@/lib/accounts";
import { createAdminClient } from "@/lib/supabase/admin";
import { z } from "zod";

const postSchema = z.object({
  account_id: z.string().uuid(),
  media_type: z.enum(["IMAGE", "REELS", "CAROUSEL"]),
  media_urls: z.array(z.string().url()).min(1),
  caption: z.string().optional(),
  scheduled_at: z.string().datetime(),
});

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const accounts = await getOwnerAccounts(supabase, userId);
  const accountIds = accounts.map((a) => a.id);

  const { data, error } = await supabase
    .from("scheduled_posts")
    .select("*, instagram_accounts(ig_username, profile_picture_url)")
    .in("account_id", accountIds)
    .order("scheduled_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

export async function POST(request: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const body = await request.json();
  const parsed = postSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = createAdminClient();
  const account = await getOwnerAccountById(supabase, userId, parsed.data.account_id);

  if (!account) {
    return NextResponse.json({ error: "Conta não encontrada" }, { status: 404 });
  }

  const { data, error } = await supabase
    .from("scheduled_posts")
    .insert({
      account_id: parsed.data.account_id,
      media_type: parsed.data.media_type,
      media_urls: parsed.data.media_urls,
      caption: parsed.data.caption ?? null,
      scheduled_at: parsed.data.scheduled_at,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
}
