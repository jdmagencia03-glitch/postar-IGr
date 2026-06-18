import { formatZodError } from "@/lib/api-errors";
import { NextRequest, NextResponse } from "next/server";
import { mediaTypeForStoryFile } from "@/lib/content-types";
import { getOwnerAccountById } from "@/lib/accounts";
import { checkInstagramStoryPublishCapability } from "@/lib/meta/instagram-stories";
import { getSessionUserId } from "@/lib/meta/oauth";
import { createAdminClient } from "@/lib/supabase/admin";
import { validateMediaUrlsForOwner } from "@/lib/security/ownership";
import { decryptPageAccessToken } from "@/lib/security/tokens";
import { sanitizeScheduledAt } from "@/lib/smart-schedule";
import { z } from "zod";

const scheduleSchema = z.object({
  account_id: z.string().uuid(),
  items: z
    .array(
      z.object({
        media_url: z.string().url(),
        filename: z.string().optional(),
        story_text: z.string().max(500),
        story_cta: z.string().max(200),
        story_link: z.string().url().optional().nullable(),
        story_objective: z.string().max(200),
      }),
    )
    .min(1)
    .max(50),
  schedule: z.array(z.string()).min(1),
  is_draft: z.boolean().optional(),
}).refine((data) => data.items.length === data.schedule.length, {
  message: "Número de horários deve corresponder aos stories",
  path: ["schedule"],
});

export async function POST(request: NextRequest) {
  const ownerId = await getSessionUserId();
  if (!ownerId) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const body = await request.json();
  const parsed = scheduleSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
  }

  const supabase = createAdminClient();
  const account = await getOwnerAccountById(supabase, ownerId, parsed.data.account_id);
  if (!account) {
    return NextResponse.json({ error: "Conta não encontrada" }, { status: 404 });
  }

  for (const item of parsed.data.items) {
    const mediaCheck = validateMediaUrlsForOwner([item.media_url], ownerId);
    if (!mediaCheck.ok) {
      return NextResponse.json({ error: mediaCheck.error }, { status: 403 });
    }
  }

  const token = decryptPageAccessToken(account.page_access_token);
  if (!token) {
    return NextResponse.json({ error: "Token da conta indisponível" }, { status: 400 });
  }

  const capability = await checkInstagramStoryPublishCapability({
    accessToken: token,
    provider: account.auth_provider ?? "instagram",
  });

  const publishBlockReason = capability.autoPublishReady
    ? null
    : capability.message;

  const rows = parsed.data.items.map((item, index) => ({
    platform: "instagram" as const,
    account_id: account.id,
    tiktok_account_id: null,
    content_type: "story" as const,
    media_type: mediaTypeForStoryFile(item.filename ?? item.media_url),
    media_urls: [item.media_url],
    caption: item.story_text.trim() || null,
    story_cta: item.story_cta,
    story_link: item.story_link ?? null,
    story_objective: item.story_objective,
    content_objective: item.story_objective,
    scheduled_at: sanitizeScheduledAt(parsed.data.schedule[index]),
    status: "pending" as const,
    is_draft: parsed.data.is_draft ?? false,
    publish_block_reason: publishBlockReason,
  }));

  const { data, error } = await supabase.from("scheduled_posts").insert(rows).select();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(
    {
      created: data?.length ?? 0,
      auto_publish_ready: capability.autoPublishReady,
      publish_block_reason: publishBlockReason,
      capability_message: capability.message,
      posts: data,
    },
    { status: 201 },
  );
}
