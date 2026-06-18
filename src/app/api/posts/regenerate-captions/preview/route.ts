import { formatZodError } from "@/lib/api-errors";
import { NextRequest, NextResponse } from "next/server";
import {
  accountNameFromPost,
  buildRegenerateCaptionsPreview,
  groupPostsByAccount,
} from "@/lib/ai/regenerate-captions";
import { getSessionUserId } from "@/lib/meta/oauth";
import { getOwnerScheduledPosts } from "@/lib/posts";
import { createAdminClient } from "@/lib/supabase/admin";
import { z } from "zod";

const previewSchema = z.object({
  account_id: z.string().uuid().optional(),
  post_ids: z.array(z.string().uuid()).optional(),
});

export async function POST(request: NextRequest) {
  const ownerId = await getSessionUserId();
  if (!ownerId) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const body = await request.json();
  const parsed = previewSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
  }

  const supabase = createAdminClient();
  const allPosts = await getOwnerScheduledPosts(supabase, ownerId, { order: "asc" });

  let targetPosts = allPosts.filter((post) => post.status === "pending" || post.status === "failed");

  if (parsed.data.post_ids?.length) {
    const idSet = new Set(parsed.data.post_ids);
    targetPosts = targetPosts.filter((post) => idSet.has(post.id));
  }

  if (parsed.data.account_id) {
    targetPosts = targetPosts.filter(
      (post) =>
        post.account_id === parsed.data.account_id ||
        post.tiktok_account_id === parsed.data.account_id,
    );
  }

  if (!targetPosts.length) {
    return NextResponse.json({ error: "Nenhum post pendente encontrado para regenerar" }, { status: 400 });
  }

  const groups = groupPostsByAccount(targetPosts);
  if (groups.size > 1 && !parsed.data.account_id) {
    return NextResponse.json(
      {
        error:
          "Os posts selecionados pertencem a contas diferentes. Selecione posts de uma única conta ou informe account_id.",
        account_ids: [...groups.keys()],
      },
      { status: 400 },
    );
  }

  const [accountId, posts] = [...groups.entries()][0];
  const accountName = accountNameFromPost(posts[0]);

  const result = await buildRegenerateCaptionsPreview({
    ownerId,
    accountId,
    accountName,
    posts,
  });

  return NextResponse.json(result);
}
