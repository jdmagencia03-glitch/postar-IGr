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

  if (!canRetryPost(post)) {
    if (post.media_id) {
      return NextResponse.json(
        { error: "Este post já foi publicado no Instagram e não pode ser reenviado" },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: "Só posts com falha ou em publicação podem ser reenviados" },
      { status: 400 },
    );
  }

  const { count: successLogs } = await supabase
    .from("publish_logs")
    .select("id", { count: "exact", head: true })
    .eq("post_id", id)
    .eq("level", "success");

  if (successLogs && successLogs > 0) {
    return NextResponse.json(
      {
        error:
          "Este post já foi publicado anteriormente (detectado nos logs). Republicação bloqueada por segurança.",
      },
      { status: 409 },
    );
  }

  const { data, error } = await supabase
    .from("scheduled_posts")
    .update({
      status: "pending",
      error_message: null,
    })
    .eq("id", id)
    .is("media_id", null)
    .select("*, instagram_accounts(ig_username, profile_picture_url)")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}
