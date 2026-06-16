import { formatZodError } from "@/lib/api-errors";
import { NextRequest, NextResponse } from "next/server";
import { resolveAutopilotAccounts, resolveScheduleForAccount } from "@/lib/autopilot-plan";
import { API_BATCH_SIZE } from "@/lib/autopilot-constants";
import { getSessionUserId } from "@/lib/meta/oauth";
import { describeSmartSchedule, type ScheduleMode } from "@/lib/smart-schedule";
import { createAdminClient } from "@/lib/supabase/admin";
import { validateMediaUrlsForOwner } from "@/lib/security/ownership";
import { z } from "zod";

const autopilotSchema = z
  .object({
    account_id: z.string().uuid().optional(),
    account_ids: z.array(z.string().uuid()).min(1).optional(),
    niche: z.string().max(120).optional(),
    schedule_mode: z.enum(["today", "auto", "warmup", "custom"]).optional(),
    platform: z.enum(["instagram", "tiktok"]).optional(),
    custom_schedule: z
      .object({
        posts_per_day: z.number().int().min(1).max(100),
        time_slots: z.array(z.string()).max(48).optional(),
        start_time: z.string().optional(),
        end_time: z.string().optional(),
      })
      .optional(),
    captions: z.array(z.string()).min(1),
    schedule: z.array(z.string()).min(1),
    items: z
      .array(
        z.object({
          media_urls: z.array(z.string().url()).min(1),
          filename: z.string().optional(),
        }),
      )
      .min(1)
      .max(API_BATCH_SIZE),
  })
  .refine((data) => Boolean(data.account_ids?.length || data.account_id), {
    message: "Selecione pelo menos uma conta",
    path: ["account_ids"],
  })
  .refine((data) => data.captions.length === data.items.length, {
    message: "Número de legendas deve corresponder aos vídeos",
    path: ["captions"],
  })
  .refine((data) => data.schedule.length === data.items.length, {
    message: "Número de horários deve corresponder aos vídeos",
    path: ["schedule"],
  });

export async function POST(request: NextRequest) {
  const ownerId = await getSessionUserId();
  if (!ownerId) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const body = await request.json();
  const parsed = autopilotSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
  }

  const requestedAccountIds = [
    ...new Set(parsed.data.account_ids ?? (parsed.data.account_id ? [parsed.data.account_id] : [])),
  ];

  const supabase = createAdminClient();

  try {
    const platform = parsed.data.platform ?? "instagram";
    const validAccounts = await resolveAutopilotAccounts(
      supabase,
      ownerId,
      requestedAccountIds,
      platform,
    );

    for (const item of parsed.data.items) {
      const mediaCheck = validateMediaUrlsForOwner(item.media_urls, ownerId);
      if (!mediaCheck.ok) {
        return NextResponse.json({ error: mediaCheck.error }, { status: 403 });
      }
    }

    const scheduleMode = (parsed.data.schedule_mode ?? "auto") as ScheduleMode;
    const usePerAccountSchedule = scheduleMode === "warmup" && platform === "instagram";

    const rows = validAccounts.flatMap((account) => {
      const schedule = usePerAccountSchedule
        ? resolveScheduleForAccount({
            account: account as import("@/lib/types").InstagramAccount,
            videoCount: parsed.data.items.length,
            scheduleMode,
          })
        : parsed.data.schedule.map((slot) => new Date(slot));

      return parsed.data.items.map((item, index) => ({
        platform,
        account_id: platform === "instagram" ? account.id : null,
        tiktok_account_id: platform === "tiktok" ? account.id : null,
        media_type: "REELS" as const,
        media_urls: item.media_urls,
        caption: parsed.data.captions[index]?.trim() || null,
        scheduled_at: schedule[index]?.toISOString() ?? parsed.data.schedule[index],
      }));
    });

    const { data, error } = await supabase.from("scheduled_posts").insert(rows).select();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const scheduleDates = rows.map((row) => new Date(row.scheduled_at));

    return NextResponse.json(
      {
        created: data?.length ?? 0,
        accounts: validAccounts.length,
        videos: parsed.data.items.length,
        schedule_mode: scheduleMode,
        caption_source: "preview",
        schedule_summary: describeSmartSchedule(scheduleDates, scheduleMode === "today" ? "today" : "auto"),
        schedule: rows.map((row) => row.scheduled_at),
        posts: data,
      },
      { status: 201 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao agendar";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
