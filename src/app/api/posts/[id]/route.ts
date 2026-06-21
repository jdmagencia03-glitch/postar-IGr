import { formatZodError } from "@/lib/api-errors";
import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/meta/oauth";
import {
  canDeleteSchedule,
  canEditPost,
  canHideFromReport,
  canReschedulePost,
  getOwnerPostById,
  getOwnerScheduledPosts,
} from "@/lib/posts";
import { createAdminClient } from "@/lib/supabase/admin";
import { contentTypeForPlatform } from "@/lib/content-types";
import { resolveRescheduleSlot } from "@/lib/schedule-insertion";
import { sanitizeScheduledAt } from "@/lib/smart-schedule";
import { z } from "zod";

const POST_SELECT_PUBLIC =
  "*, instagram_accounts(ig_username, profile_picture_url), tiktok_accounts(username, display_name, profile_picture_url)";

const patchSchema = z.object({
  caption: z.string().optional(),
  scheduled_at: z.string().datetime().optional(),
  hidden_from_report: z.boolean().optional(),
});

export async function GET(
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

  const { data: publicPost } = await supabase
    .from("scheduled_posts")
    .select(POST_SELECT_PUBLIC)
    .eq("id", id)
    .maybeSingle();

  let siblingPosts: unknown[] = [];
  if (post.parent_publish_group_id) {
    const allPosts = await getOwnerScheduledPosts(supabase, userId, { limit: 5000 });
    const siblings = allPosts.filter(
      (p) => p.parent_publish_group_id === post.parent_publish_group_id && p.id !== id,
    );
    siblingPosts = siblings;
  }

  const { data: logs } = await supabase
    .from("publish_logs")
    .select("*")
    .eq("post_id", id)
    .order("created_at", { ascending: true });

  return NextResponse.json({
    post: publicPost ?? post,
    siblingPosts,
    logs: logs ?? [],
  });
}

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
    return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
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

    const platform = post.platform ?? "instagram";
    const accountId = platform === "tiktok" ? post.tiktok_account_id : post.account_id;
    if (!accountId) {
      return NextResponse.json({ error: "Conta do post não encontrada" }, { status: 400 });
    }

    const resolved = await resolveRescheduleSlot({
      supabase,
      platform,
      accountId,
      contentType: post.content_type ?? contentTypeForPlatform(platform),
      requestedAt: parsed.data.scheduled_at,
      excludePostId: id,
    });
    updates.scheduled_at = sanitizeScheduledAt(resolved.scheduled_at);
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
