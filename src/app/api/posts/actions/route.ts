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

const actionsSchema = z.object({
  action: z.enum(["delete", "reschedule", "update_caption", "hide_from_report", "duplicate"]),
  post_ids: z.array(z.string().uuid()).min(1),
  scheduled_at: z.string().datetime().optional(),
  caption: z.string().optional(),
});

export async function POST(request: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const body = await request.json();
  const parsed = actionsSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { action, post_ids, scheduled_at, caption } = parsed.data;
  const supabase = createAdminClient();
  const results: Array<{ id: string; ok: boolean; error?: string }> = [];

  if (action === "reschedule" && !scheduled_at) {
    return NextResponse.json({ error: "Informe scheduled_at para reagendar" }, { status: 400 });
  }

  if (action === "update_caption" && caption === undefined) {
    return NextResponse.json({ error: "Informe caption para alterar legenda" }, { status: 400 });
  }

  const baseTime = scheduled_at ? new Date(scheduled_at).getTime() : 0;

  for (let index = 0; index < post_ids.length; index++) {
    const postId = post_ids[index];
    const post = await getOwnerPostById(supabase, userId, postId);

    if (!post) {
      results.push({ id: postId, ok: false, error: "Post não encontrado" });
      continue;
    }

    if (action === "delete") {
      if (!canDeleteSchedule(post.status)) {
        results.push({ id: postId, ok: false, error: "Status não permite exclusão" });
        continue;
      }

      const { error } = await supabase.from("scheduled_posts").delete().eq("id", postId);
      results.push({ id: postId, ok: !error, error: error?.message });
      continue;
    }

    if (action === "hide_from_report") {
      if (!canHideFromReport(post.status)) {
        results.push({ id: postId, ok: false, error: "Só posts publicados podem ser ocultados" });
        continue;
      }

      const { error } = await supabase
        .from("scheduled_posts")
        .update({ hidden_from_report: true })
        .eq("id", postId);
      results.push({ id: postId, ok: !error, error: error?.message });
      continue;
    }

    if (action === "update_caption") {
      if (!canEditPost(post.status)) {
        results.push({ id: postId, ok: false, error: "Status não permite editar legenda" });
        continue;
      }

      const { error } = await supabase
        .from("scheduled_posts")
        .update({ caption })
        .eq("id", postId);
      results.push({ id: postId, ok: !error, error: error?.message });
      continue;
    }

    if (action === "reschedule") {
      if (!canReschedulePost(post.status)) {
        results.push({ id: postId, ok: false, error: "Status não permite reagendar" });
        continue;
      }

      const nextTime = new Date(baseTime + index * 60_000).toISOString();
      const { error } = await supabase
        .from("scheduled_posts")
        .update({ scheduled_at: nextTime })
        .eq("id", postId);
      results.push({ id: postId, ok: !error, error: error?.message });
      continue;
    }

    if (action === "duplicate") {
      const duplicateAt = new Date(post.scheduled_at);
      duplicateAt.setDate(duplicateAt.getDate() + 1 + index);

      const { error } = await supabase.from("scheduled_posts").insert({
        account_id: post.account_id,
        media_type: post.media_type,
        media_urls: post.media_urls,
        caption: post.caption,
        scheduled_at: duplicateAt.toISOString(),
        status: "pending",
      });

      results.push({ id: postId, ok: !error, error: error?.message });
    }
  }

  const succeeded = results.filter((item) => item.ok).length;
  const failed = results.length - succeeded;

  return NextResponse.json({
    ok: failed === 0,
    succeeded,
    failed,
    results,
  });
}
