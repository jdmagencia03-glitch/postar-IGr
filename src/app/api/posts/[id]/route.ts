import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/meta/oauth";
import {
  canDeleteSchedule,
  canEditPost,
  canHideFromReport,
  canReschedulePost,
  getOwnerPostById,
} from "@/lib/posts";
import { createAdminClient } from "@/lib/supabase/admin";
import { z } from "zod";

const patchSchema = z.object({
  caption: z.string().optional(),
  scheduled_at: z.string().datetime().optional(),
  hidden_from_report: z.boolean().optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json();
  const parsed = patchSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = createAdminClient();
  const post = await getOwnerPostById(supabase, userId, id);

  if (!post) {
    return NextResponse.json({ error: "Post não encontrado" }, { status: 404 });
  }

  const updates: Record<string, unknown> = {};

  if (parsed.data.hidden_from_report !== undefined) {
    if (!canHideFromReport(post.status)) {
      return NextResponse.json(
        { error: "Só posts publicados podem ser ocultados do relatório" },
        { status: 400 },
      );
    }
    updates.hidden_from_report = parsed.data.hidden_from_report;
  }

  if (parsed.data.caption !== undefined) {
    if (!canEditPost(post.status)) {
      return NextResponse.json(
        { error: "Este post não pode ser editado no status atual" },
        { status: 400 },
      );
    }
    updates.caption = parsed.data.caption;
  }

  if (parsed.data.scheduled_at !== undefined) {
    if (!canReschedulePost(post.status)) {
      return NextResponse.json(
        { error: "Este post não pode ser reagendado no status atual" },
        { status: 400 },
      );
    }
    updates.scheduled_at = parsed.data.scheduled_at;
  }

  if (!Object.keys(updates).length) {
    return NextResponse.json({ error: "Nenhuma alteração informada" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("scheduled_posts")
    .update(updates)
    .eq("id", id)
    .select("*, instagram_accounts(ig_username, profile_picture_url)")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const { id } = await params;
  const supabase = createAdminClient();
  const post = await getOwnerPostById(supabase, userId, id);

  if (!post) {
    return NextResponse.json({ error: "Post não encontrado" }, { status: 404 });
  }

  if (!canDeleteSchedule(post.status)) {
    return NextResponse.json(
      { error: "Posts publicados não podem ser excluídos da fila. Use ocultar do relatório." },
      { status: 400 },
    );
  }

  const { error } = await supabase.from("scheduled_posts").delete().eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
