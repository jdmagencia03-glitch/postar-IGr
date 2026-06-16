import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/meta/oauth";
import { canRetryPost, getOwnerPostById } from "@/lib/posts";
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

  if (!canRetryPost(post.status)) {
    return NextResponse.json(
      { error: "Só posts com falha podem ser reenviados" },
      { status: 400 },
    );
  }

  const { data, error } = await supabase
    .from("scheduled_posts")
    .update({
      status: "pending",
      error_message: null,
    })
    .eq("id", id)
    .select("*, instagram_accounts(ig_username, profile_picture_url)")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}
