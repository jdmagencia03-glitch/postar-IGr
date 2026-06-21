import { formatZodError } from "@/lib/api-errors";
import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/meta/oauth";
import { getOwnerAccountById, getOwnerAccounts } from "@/lib/accounts";
import { getOwnerScheduledPosts } from "@/lib/posts";
import { createAdminClient } from "@/lib/supabase/admin";
import { logSecurityEvent } from "@/lib/security/audit";
import { validateScheduledMediaUrls, scheduleMediaGuardJsonError } from "@/lib/storage/schedule-media-guard";
import { sanitizeScheduledAt } from "@/lib/smart-schedule";
import { z } from "zod";

const postSchema = z.object({
  account_id: z.string().uuid(),
  media_type: z.enum(["IMAGE", "REELS", "CAROUSEL"]),
  media_urls: z.array(z.string().url()).min(1),
  caption: z.string().optional(),
  scheduled_at: z.string().datetime(),
});

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const data = await getOwnerScheduledPosts(supabase, userId, { order: "asc" });

  return NextResponse.json(data);
}

export async function POST(request: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const body = await request.json();
  const parsed = postSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
  }

  const supabase = createAdminClient();
  const account = await getOwnerAccountById(supabase, userId, parsed.data.account_id);

  if (!account) {
    return NextResponse.json({ error: "Conta não encontrada" }, { status: 404 });
  }

  const mediaCheck = await validateScheduledMediaUrls({
    supabase,
    ownerId: userId,
    urls: parsed.data.media_urls,
  });
  if (!mediaCheck.ok) {
    return NextResponse.json(scheduleMediaGuardJsonError(mediaCheck), { status: 400 });
  }

  const { data, error } = await supabase
    .from("scheduled_posts")
    .insert({
      account_id: parsed.data.account_id,
      media_type: parsed.data.media_type,
      media_urls: parsed.data.media_urls,
      media_asset_id: mediaCheck.mediaAssetIds[0] ?? null,
      caption: parsed.data.caption ?? null,
      scheduled_at: sanitizeScheduledAt(parsed.data.scheduled_at),
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await logSecurityEvent({
    ownerId: userId,
    eventType: "post_scheduled",
    resourceType: "scheduled_post",
    resourceId: data.id,
    metadata: { accountId: parsed.data.account_id },
  });

  return NextResponse.json(data, { status: 201 });
}
