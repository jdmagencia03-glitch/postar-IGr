import { getOwnerAccountById } from "@/lib/accounts";
import { formatZodError } from "@/lib/api-errors";
import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/meta/oauth";
import { contentTypeForPlatform } from "@/lib/content-types";
import { filterDuplicateScheduleRows } from "@/lib/publish/schedule-guard";
import { sanitizeScheduledAt } from "@/lib/smart-schedule";
import { createAdminClient } from "@/lib/supabase/admin";
import { mergeCampaignFields, resolveSchedulingCampaignContext } from "@/lib/campaigns/context";
import { validateScheduledMediaUrls } from "@/lib/storage/schedule-media-guard";
import { getOwnerTikTokAccountById } from "@/lib/tiktok/accounts";
import { z } from "zod";

const confirmSchema = z.object({
  videos: z
    .array(
      z.object({
        parent_publish_group_id: z.string().uuid(),
        media_urls: z.array(z.string().url()).min(1),
        filename: z.string().optional(),
        destinations: z
          .array(
            z.object({
              platform: z.enum(["instagram", "tiktok"]),
              account_id: z.string().uuid(),
              caption: z.string(),
              scheduled_at: z.string().datetime(),
            }),
          )
          .min(1)
          .max(2),
      }),
    )
    .min(1)
    .max(50),
  product_id: z.string().uuid().optional().nullable(),
  campaign_id: z.string().uuid().optional().nullable(),
  content_objective: z.string().max(200).optional().nullable(),
  upload_batch_id: z.string().uuid().optional().nullable(),
});

export async function POST(request: NextRequest) {
  const ownerId = await getSessionUserId();
  if (!ownerId) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const body = await request.json();
  const parsed = confirmSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
  }

  const supabase = createAdminClient();
  const validatedAccounts = new Map<string, "instagram" | "tiktok">();
  const campaignContext = await resolveSchedulingCampaignContext(supabase, ownerId, parsed.data);
  const campaignFields = mergeCampaignFields(campaignContext);
  const skippedVideos: Array<{ filename?: string; reason: string }> = [];
  const schedulableVideos = [];

  for (const video of parsed.data.videos) {
    const mediaCheck = await validateScheduledMediaUrls({
      supabase,
      ownerId,
      urls: video.media_urls,
    });
    if (!mediaCheck.ok) {
      skippedVideos.push({
        filename: video.filename,
        reason: `${mediaCheck.code}: ${mediaCheck.message}`,
      });
      continue;
    }

    let videoValid = true;
    for (const dest of video.destinations) {
      const knownPlatform = validatedAccounts.get(dest.account_id);
      if (knownPlatform) {
        if (knownPlatform !== dest.platform) {
          skippedVideos.push({
            filename: video.filename,
            reason: "Conta inválida para a plataforma informada.",
          });
          videoValid = false;
          break;
        }
        continue;
      }

      if (dest.platform === "tiktok") {
        const account = await getOwnerTikTokAccountById(supabase, ownerId, dest.account_id);
        if (!account) {
          skippedVideos.push({
            filename: video.filename,
            reason: "Conta TikTok não encontrada ou sem permissão para agendar.",
          });
          videoValid = false;
          break;
        }
      } else {
        const account = await getOwnerAccountById(supabase, ownerId, dest.account_id);
        if (!account) {
          skippedVideos.push({
            filename: video.filename,
            reason: "Conta Instagram não encontrada ou sem permissão para agendar.",
          });
          videoValid = false;
          break;
        }
      }

      validatedAccounts.set(dest.account_id, dest.platform);
    }

    if (videoValid) {
      schedulableVideos.push(video);
    }
  }

  if (!schedulableVideos.length) {
    return NextResponse.json(
      {
        error: "Nenhum vídeo pôde ser agendado. Todos falharam na validação.",
        skipped_videos: skippedVideos.length,
        skipped: skippedVideos,
      },
      { status: 409 },
    );
  }

  const rows = schedulableVideos.flatMap((video) =>
    video.destinations.map((dest) => ({
      platform: dest.platform,
      account_id: dest.platform === "instagram" ? dest.account_id : null,
      tiktok_account_id: dest.platform === "tiktok" ? dest.account_id : null,
      content_type: contentTypeForPlatform(dest.platform),
      media_type: "REELS" as const,
      media_urls: video.media_urls,
      caption: dest.caption.trim() || null,
      scheduled_at: sanitizeScheduledAt(dest.scheduled_at),
      parent_publish_group_id: video.parent_publish_group_id,
      status: "pending" as const,
      product_id: campaignFields.product_id,
      campaign_id: campaignFields.campaign_id,
      content_objective: campaignFields.content_objective,
      upload_batch_id: parsed.data.upload_batch_id ?? null,
    })),
  );

  const { accepted, skipped } = await filterDuplicateScheduleRows(supabase, rows);

  if (!accepted.length) {
    return NextResponse.json(
      {
        error:
          "Todos os vídeos já estão na fila de publicação. Evite clicar em agendar duas vezes.",
        skipped,
        skipped_videos: skippedVideos.length + schedulableVideos.length,
      },
      { status: 409 },
    );
  }

  const { data, error } = await supabase.from("scheduled_posts").insert(accepted).select();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(
    {
      created: data?.length ?? 0,
      skipped: skipped.length,
      skipped_videos: skippedVideos.length,
      skipped_details: skippedVideos,
      videos: schedulableVideos.length,
      posts: data,
    },
    { status: 201 },
  );
}
