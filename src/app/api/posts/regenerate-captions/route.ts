import { formatZodError } from "@/lib/api-errors";
import { NextRequest, NextResponse } from "next/server";
import { logCaptionGeneration } from "@/lib/ai/caption-debug";
import { getSessionUserId } from "@/lib/meta/oauth";
import { createAdminClient } from "@/lib/supabase/admin";
import { z } from "zod";

const applySchema = z.object({
  updates: z
    .array(
      z.object({
        post_id: z.string().uuid(),
        caption: z.string().max(2200),
      }),
    )
    .min(1)
    .max(500),
});

export async function POST(request: NextRequest) {
  const ownerId = await getSessionUserId();
  if (!ownerId) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const body = await request.json();
  const parsed = applySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
  }

  const supabase = createAdminClient();
  let updated = 0;
  let failed = 0;

  for (const item of parsed.data.updates) {
    const { data: post } = await supabase
      .from("scheduled_posts")
      .select("id, status, account_id, tiktok_account_id")
      .eq("id", item.post_id)
      .maybeSingle();

    if (!post || (post.status !== "pending" && post.status !== "failed")) {
      failed += 1;
      continue;
    }

    const accountId = post.account_id ?? post.tiktok_account_id;
    if (!accountId) {
      failed += 1;
      continue;
    }

    const ownerCheck =
      post.account_id != null
        ? await supabase
            .from("instagram_accounts")
            .select("id")
            .eq("id", post.account_id)
            .eq("owner_id", ownerId)
            .maybeSingle()
        : await supabase
            .from("tiktok_accounts")
            .select("id")
            .eq("id", post.tiktok_account_id)
            .eq("owner_id", ownerId)
            .maybeSingle();

    if (!ownerCheck.data) {
      failed += 1;
      continue;
    }

    const { error } = await supabase
      .from("scheduled_posts")
      .update({ caption: item.caption.trim() })
      .eq("id", item.post_id);

    if (error) {
      failed += 1;
    } else {
      updated += 1;
    }
  }

  logCaptionGeneration("regenerate_applied", {
    ownerId,
    updated,
    failed,
    total: parsed.data.updates.length,
  });

  return NextResponse.json({
    updated,
    failed,
    message: `${updated} legenda(s) atualizada(s)${failed ? ` · ${failed} não puderam ser alteradas` : ""}`,
  });
}
