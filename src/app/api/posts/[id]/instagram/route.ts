import { NextRequest, NextResponse } from "next/server";
import { deletePublishedMedia } from "@/lib/meta/instagram";
import { getSessionUserId } from "@/lib/meta/oauth";
import { canDeleteFromInstagram, getOwnerPostById } from "@/lib/posts";
import { createAdminClient } from "@/lib/supabase/admin";

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

  if (!canDeleteFromInstagram(post.status)) {
    return NextResponse.json(
      { error: "Só posts publicados podem ser excluídos do Instagram" },
      { status: 400 },
    );
  }

  if (!post.media_id) {
    return NextResponse.json(
      { error: "Este post não possui ID de mídia no Instagram" },
      { status: 400 },
    );
  }

  const account = post.instagram_accounts;
  if (!account?.page_access_token) {
    return NextResponse.json({ error: "Conta não encontrada" }, { status: 404 });
  }

  try {
    await deletePublishedMedia(
      post.media_id,
      account.page_access_token,
      account.auth_provider === "facebook" ? "facebook" : "instagram",
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao excluir no Instagram" },
      { status: 502 },
    );
  }

  const { data, error } = await supabase
    .from("scheduled_posts")
    .update({
      hidden_from_report: true,
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
