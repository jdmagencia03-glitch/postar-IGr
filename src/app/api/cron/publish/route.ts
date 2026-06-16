import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { publishPost } from "@/lib/meta/instagram";
import { decryptPageAccessToken } from "@/lib/security/tokens";
import { getCronSecret } from "@/lib/security/secrets";

export const maxDuration = 300;

async function log(
  supabase: ReturnType<typeof createAdminClient>,
  postId: string,
  level: "info" | "error" | "success",
  message: string,
) {
  await supabase.from("publish_logs").insert({ post_id: postId, level, message });
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = getCronSecret();

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const now = new Date().toISOString();

  const { data: posts, error } = await supabase
    .from("scheduled_posts")
    .select("*, instagram_accounts(ig_user_id, page_access_token, auth_provider)")
    .eq("status", "pending")
    .lte("scheduled_at", now)
    .order("scheduled_at", { ascending: true })
    .limit(5);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const results: Array<{ id: string; status: string; error?: string }> = [];

  for (const post of posts ?? []) {
    const account = post.instagram_accounts as {
      ig_user_id: string;
      page_access_token: string;
      auth_provider?: "instagram" | "facebook" | null;
    } | null;

    if (!account) {
      await supabase
        .from("scheduled_posts")
        .update({ status: "failed", error_message: "Conta não encontrada" })
        .eq("id", post.id);
      continue;
    }

    const accessToken = decryptPageAccessToken(account.page_access_token);
    if (!accessToken) {
      await supabase
        .from("scheduled_posts")
        .update({ status: "failed", error_message: "Token da conta indisponível" })
        .eq("id", post.id);
      continue;
    }

    await supabase.from("scheduled_posts").update({ status: "processing" }).eq("id", post.id);
    await log(supabase, post.id, "info", "Iniciando publicação");

    try {
      const result = await publishPost({
        igUserId: account.ig_user_id,
        token: accessToken,
        mediaType: post.media_type,
        mediaUrls: post.media_urls,
        caption: post.caption ?? undefined,
        provider: account.auth_provider === "facebook" ? "facebook" : "instagram",
      });

      await supabase
        .from("scheduled_posts")
        .update({
          status: "published",
          container_id: result.containerId,
          media_id: result.mediaId,
          permalink: result.permalink,
          published_at: new Date().toISOString(),
          error_message: null,
        })
        .eq("id", post.id);

      await log(supabase, post.id, "success", `Publicado: ${result.permalink}`);
      results.push({ id: post.id, status: "published" });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erro desconhecido";
      await supabase
        .from("scheduled_posts")
        .update({ status: "failed", error_message: message })
        .eq("id", post.id);
      await log(supabase, post.id, "error", message);
      results.push({ id: post.id, status: "failed", error: message });
    }
  }

  return NextResponse.json({
    processed: results.length,
    results,
  });
}
