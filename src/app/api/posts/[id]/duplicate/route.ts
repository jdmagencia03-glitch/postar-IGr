import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/meta/oauth";
import { getOwnerPostById } from "@/lib/posts";
import { sanitizeScheduledAt } from "@/lib/smart-schedule";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(
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

  const duplicateAt = new Date(post.scheduled_at);
  duplicateAt.setDate(duplicateAt.getDate() + 1);

  const { data, error } = await supabase
    .from("scheduled_posts")
    .insert({
      platform: post.platform ?? "instagram",
      account_id: post.account_id,
      tiktok_account_id: post.tiktok_account_id,
      media_type: post.media_type,
      media_urls: post.media_urls,
      caption: post.caption,
      scheduled_at: sanitizeScheduledAt(duplicateAt.toISOString()),
      status: "pending",
    })
    .select("*, instagram_accounts(ig_username, profile_picture_url)")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
}
