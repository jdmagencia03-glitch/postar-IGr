import { NextResponse } from "next/server";
import { formatZodError } from "@/lib/api-errors";
import { getOwnerAccountById } from "@/lib/accounts";
import { listAutomationsForOwner } from "@/lib/comment-dm/repository";
import { getSessionUserId } from "@/lib/meta/oauth";
import { createAdminClient } from "@/lib/supabase/admin";
import { z } from "zod";

const createSchema = z.object({
  account_id: z.string().uuid(),
  name: z.string().min(1).max(120).default("Automação DM"),
  dm_message_template: z.string().min(1).max(2000),
  dm_link: z.union([z.string().url(), z.literal(""), z.null()]).optional(),
  apply_to: z.enum(["all", "specific"]).default("all"),
  target_media_ids: z.array(z.string()).default([]),
  primary_keyword: z.string().min(1).max(200),
  keyword_variations: z.array(z.string()).default([]),
  enabled: z.boolean().default(true),
});

function buildKeywords(primary: string, variations: string[]) {
  const all = [primary, ...variations]
    .map((k) => k.trim())
    .filter(Boolean);
  return [...new Set(all)];
}

export async function GET() {
  const ownerId = await getSessionUserId();
  if (!ownerId) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const automations = await listAutomationsForOwner(supabase, ownerId);
  return NextResponse.json(automations);
}

export async function POST(request: Request) {
  const ownerId = await getSessionUserId();
  if (!ownerId) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const body = await request.json();
  const parsed = createSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
  }

  const supabase = createAdminClient();
  const account = await getOwnerAccountById(supabase, ownerId, parsed.data.account_id);

  if (!account) {
    return NextResponse.json({ error: "Conta Instagram não encontrada" }, { status: 404 });
  }

  if (account.auth_provider !== "facebook" || !account.page_id) {
    return NextResponse.json(
      {
        error:
          "Para automação de DM, conecte a conta via Facebook (Instagram Business vinculado a uma Página).",
      },
      { status: 400 },
    );
  }

  if (parsed.data.apply_to === "specific" && !parsed.data.target_media_ids.length) {
    return NextResponse.json(
      { error: "Selecione ao menos um post/reels ou use a opção todos os posts." },
      { status: 400 },
    );
  }

  const keywords = buildKeywords(parsed.data.primary_keyword, parsed.data.keyword_variations);
  const dmLink = parsed.data.dm_link?.trim() || null;

  const { data, error } = await supabase
    .from("comment_dm_automations")
    .insert({
      owner_id: ownerId,
      account_id: parsed.data.account_id,
      name: parsed.data.name,
      enabled: parsed.data.enabled,
      dm_message_template: parsed.data.dm_message_template,
      dm_link: dmLink,
      apply_to: parsed.data.apply_to,
      target_media_ids: parsed.data.target_media_ids,
      keywords,
    })
    .select("*, instagram_accounts(id, ig_username, auth_provider, page_id)")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
}
