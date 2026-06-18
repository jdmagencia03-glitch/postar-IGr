import { getOwnerAccountById } from "@/lib/accounts";
import { formatZodError } from "@/lib/api-errors";
import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/meta/oauth";
import { contentTypeForPlatform } from "@/lib/content-types";
import { filterDuplicateScheduleRows } from "@/lib/publish/schedule-guard";
import { sanitizeScheduledAt } from "@/lib/smart-schedule";
import { createAdminClient } from "@/lib/supabase/admin";
import { validateMediaUrlsForOwner } from "@/lib/security/ownership";
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

  for (const video of parsed.data.videos) {
    const mediaCheck = validateMediaUrlsForOwner(video.media_urls, ownerId);
    if (!mediaCheck.ok) {
      return NextResponse.json({ error: mediaCheck.error }, { status: 403 });
    }

    for (const dest of video.destinations) {
      const knownPlatform = validatedAccounts.get(dest.account_id);
      if (knownPlatform) {
        if (knownPlatform !== dest.platform) {
          return NextResponse.json(
            { error: "Conta inválida para a plataforma informada." },
            { status: 400 },
          );
        }
        continue;
      }

      if (dest.platform === "tiktok") {
        const account = await getOwnerTikTokAccountById(supabase, ownerId, dest.account_id);
        if (!account) {
          return NextResponse.json(
            { error: "Conta TikTok não encontrada ou sem permissão para agendar." },
            { status: 403 },
          );
        }
      } else {
        const account = await getOwnerAccountById(supabase, ownerId, dest.account_id);
        if (!account) {
          return NextResponse.json(
            { error: "Conta Instagram não encontrada ou sem permissão para agendar." },
            { status: 403 },
          );
        }
      }

      validatedAccounts.set(dest.account_id, dest.platform);
    }
  }

  const rows = parsed.data.videos.flatMap((video) =>
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
    })),
  );

  const { accepted, skipped } = await filterDuplicateScheduleRows(supabase, rows);

  if (!accepted.length) {
    return NextResponse.json(
      {
        error:
          "Todos os vídeos já estão na fila de publicação. Evite clicar em agendar duas vezes.",
        skipped,
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
      videos: parsed.data.videos.length,
      posts: data,
    },
    { status: 201 },
  );
}
