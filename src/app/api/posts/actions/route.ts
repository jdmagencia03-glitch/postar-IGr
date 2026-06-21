import { formatZodError } from "@/lib/api-errors";
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
import { contentTypeForPlatform } from "@/lib/content-types";
import { resolveRescheduleSlot } from "@/lib/schedule-insertion";
import { ensureFutureScheduleSlot, sanitizeScheduledAt } from "@/lib/smart-schedule";
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
    return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
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

  const baseTime = scheduled_at
    ? new Date(sanitizeScheduledAt(scheduled_at)).getTime()
    : 0;

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

      const platform = post.platform ?? "instagram";
      const accountId =
        platform === "tiktok" ? post.tiktok_account_id : post.account_id;
      if (!accountId) {
        results.push({ id: postId, ok: false, error: "Conta do post não encontrada" });
        continue;
      }

      const resolved = await resolveRescheduleSlot({
        supabase,
        platform,
        accountId,
        contentType: post.content_type ?? contentTypeForPlatform(platform),
        requestedAt: new Date(baseTime).toISOString(),
        excludePostId: postId,
      });

      const { error } = await supabase
        .from("scheduled_posts")
        .update({ scheduled_at: sanitizeScheduledAt(resolved.scheduled_at) })
        .eq("id", postId);
      results.push({
        id: postId,
        ok: !error,
        error: error?.message ?? resolved.warning,
      });
      continue;
    }

    if (action === "duplicate") {
      const platform = post.platform ?? "instagram";
      const accountId = platform === "tiktok" ? post.tiktok_account_id : post.account_id;
      if (!accountId) {
        results.push({ id: postId, ok: false, error: "Conta do post não encontrada" });
        continue;
      }

      const resolved = await resolveRescheduleSlot({
        supabase,
        platform,
        accountId,
        contentType: post.content_type ?? contentTypeForPlatform(platform),
        requestedAt: ensureFutureScheduleSlot(new Date(post.scheduled_at)).toISOString(),
      });

      const { error } = await supabase.from("scheduled_posts").insert({
        platform,
        account_id: post.account_id,
        tiktok_account_id: post.tiktok_account_id,
        content_type: post.content_type ?? "reel",
        media_type: post.media_type,
        media_urls: post.media_urls,
        caption: post.caption,
        scheduled_at: sanitizeScheduledAt(resolved.scheduled_at),
        status: "pending",
      });

      results.push({ id: postId, ok: !error, error: error?.message ?? resolved.warning });
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
