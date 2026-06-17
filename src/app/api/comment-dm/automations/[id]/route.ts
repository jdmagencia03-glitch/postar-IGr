import { NextResponse } from "next/server";
import { formatZodError } from "@/lib/api-errors";
import { getAutomationForOwner } from "@/lib/comment-dm/repository";
import { getSessionUserId } from "@/lib/meta/oauth";
import { createAdminClient } from "@/lib/supabase/admin";
import { z } from "zod";

const patchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  enabled: z.boolean().optional(),
  dm_message_template: z.string().min(1).max(2000).optional(),
  dm_link: z.union([z.string().url(), z.literal(""), z.null()]).optional(),
  apply_to: z.enum(["all", "specific"]).optional(),
  target_media_ids: z.array(z.string()).optional(),
  primary_keyword: z.string().min(1).max(200).optional(),
  keyword_variations: z.array(z.string()).optional(),
});

function buildKeywords(primary: string, variations: string[]) {
  const all = [primary, ...variations]
    .map((k) => k.trim())
    .filter(Boolean);
  return [...new Set(all)];
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ownerId = await getSessionUserId();
  if (!ownerId) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json();
  const parsed = patchSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
  }

  const supabase = createAdminClient();
  const existing = await getAutomationForOwner(supabase, ownerId, id);

  if (!existing) {
    return NextResponse.json({ error: "Automação não encontrada" }, { status: 404 });
  }

  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (parsed.data.name !== undefined) updates.name = parsed.data.name;
  if (parsed.data.enabled !== undefined) updates.enabled = parsed.data.enabled;
  if (parsed.data.dm_message_template !== undefined) {
    updates.dm_message_template = parsed.data.dm_message_template;
  }
  if (parsed.data.dm_link !== undefined) {
    updates.dm_link = parsed.data.dm_link?.trim() || null;
  }
  if (parsed.data.apply_to !== undefined) updates.apply_to = parsed.data.apply_to;
  if (parsed.data.target_media_ids !== undefined) {
    updates.target_media_ids = parsed.data.target_media_ids;
  }

  if (parsed.data.primary_keyword !== undefined) {
    const variations =
      parsed.data.keyword_variations ??
      existing.keywords.filter((k) => k !== parsed.data.primary_keyword);
    updates.keywords = buildKeywords(parsed.data.primary_keyword, variations);
  } else if (parsed.data.keyword_variations !== undefined) {
    const primary = existing.keywords[0] ?? "";
    updates.keywords = buildKeywords(primary, parsed.data.keyword_variations);
  }

  const applyTo = (updates.apply_to as string | undefined) ?? existing.apply_to;
  const mediaIds =
    (updates.target_media_ids as string[] | undefined) ?? existing.target_media_ids;

  if (applyTo === "specific" && !mediaIds.length) {
    return NextResponse.json(
      { error: "Selecione ao menos um post/reels ou use a opção todos os posts." },
      { status: 400 },
    );
  }

  const { data, error } = await supabase
    .from("comment_dm_automations")
    .update(updates)
    .eq("id", id)
    .eq("owner_id", ownerId)
    .select("*, instagram_accounts(id, ig_username, auth_provider, page_id)")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ownerId = await getSessionUserId();
  if (!ownerId) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const { id } = await params;
  const supabase = createAdminClient();
  const existing = await getAutomationForOwner(supabase, ownerId, id);

  if (!existing) {
    return NextResponse.json({ error: "Automação não encontrada" }, { status: 404 });
  }

  const { error } = await supabase
    .from("comment_dm_automations")
    .delete()
    .eq("id", id)
    .eq("owner_id", ownerId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
