import { formatZodError } from "@/lib/api-errors";
import { NextRequest, NextResponse } from "next/server";
import { buildAutopilotPlan, resolveAutopilotAccounts } from "@/lib/autopilot-plan";
import { API_BATCH_SIZE } from "@/lib/autopilot-constants";
import {
  DEFAULT_WARMUP_DAYS,
  getWarmupStatus,
  resolveAutoScheduleOptions,
  type AutoAccountProfile,
} from "@/lib/account-warmup";
import { getSessionUserId } from "@/lib/meta/oauth";
import { parseCustomSchedulePayload, parseTimeSlots } from "@/lib/smart-schedule";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveSchedulingCampaignContext } from "@/lib/campaigns/context";
import { resolveDefaultInsertionStrategy } from "@/lib/schedule-insertion";
import type { InstagramAccount, TikTokAccount } from "@/lib/types";
import { z } from "zod";

const customScheduleSchema = z.object({
  posts_per_day: z.number().int().min(1).max(100),
  time_slots: z.array(z.string()).max(48).optional(),
  start_time: z.string().optional(),
  end_time: z.string().optional(),
});

const previewSchema = z
  .object({
    account_id: z.string().uuid().optional(),
    account_ids: z.array(z.string().uuid()).min(1).optional(),
    niche: z.string().max(120).optional(),
    schedule_mode: z.enum(["today", "auto", "warmup", "custom"]).optional(),
    auto_profile: z.enum(["new", "growing", "strong"]).optional(),
    platform: z.enum(["instagram", "tiktok"]).optional(),
    custom_schedule: customScheduleSchema.optional(),
    batch_offset: z.number().int().min(0).optional(),
    total_count: z.number().int().min(1).optional(),
    upload_batch_id: z.string().uuid().optional().nullable(),
    schedule_strategy: z.enum(["continue", "new_plan", "fill_gaps"]).optional(),
    batch_scheduled_count: z.number().int().min(0).optional(),
    product_id: z.string().uuid().optional().nullable(),
    campaign_id: z.string().uuid().optional().nullable(),
    content_objective: z.string().max(200).optional().nullable(),
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
  .refine(
    (data) => data.schedule_mode !== "custom" || Boolean(data.custom_schedule),
    {
      message: "Informe posts por dia e horários no modo personalizado",
      path: ["custom_schedule"],
    },
  );

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

  const requestedAccountIds = [
    ...new Set(parsed.data.account_ids ?? (parsed.data.account_id ? [parsed.data.account_id] : [])),
  ];

  try {
    const supabase = createAdminClient();
    const platform = parsed.data.platform ?? "instagram";
    const validAccounts = await resolveAutopilotAccounts(
      supabase,
      ownerId,
      requestedAccountIds,
      platform,
    );
    const primaryAccount = validAccounts[0];
    const primaryUsername =
      platform === "tiktok"
        ? (primaryAccount as TikTokAccount).username ??
          (primaryAccount as TikTokAccount).display_name ??
          "perfil"
        : (primaryAccount as InstagramAccount).ig_username ?? "perfil";
    const scheduleMode = parsed.data.schedule_mode ?? "auto";

    let warmup:
      | {
          warmupDays?: number;
        }
      | undefined;

    if (scheduleMode === "warmup" && primaryAccount) {
      if (platform === "instagram") {
        const igAccount = primaryAccount as InstagramAccount;
        warmup = {
          warmupDays: igAccount.warmup_days ?? DEFAULT_WARMUP_DAYS,
        };
      } else {
        warmup = {
          warmupDays: DEFAULT_WARMUP_DAYS,
        };
      }
    }

    const auto =
      scheduleMode === "auto"
        ? resolveAutoScheduleOptions({
            profile: parsed.data.auto_profile as AutoAccountProfile | undefined,
            igAccount:
              platform === "instagram" ? (primaryAccount as InstagramAccount) : null,
          })
        : undefined;

    const custom =
      scheduleMode === "custom" && parsed.data.custom_schedule
        ? parseCustomSchedulePayload(parsed.data.custom_schedule)
        : undefined;

    if (scheduleMode === "custom" && (!custom || !custom.timeSlots.length)) {
      return NextResponse.json(
        { error: "Horários inválidos. Use o formato HH:mm." },
        { status: 400 },
      );
    }

    const plan = await buildAutopilotPlan({
      items: parsed.data.items,
      niche: parsed.data.niche,
      username: primaryUsername,
      ownerId,
      accountId: primaryAccount.id,
      schedule_mode: scheduleMode,
      batch_offset: parsed.data.batch_offset,
      total_count: parsed.data.total_count ?? parsed.data.items.length,
      warmup,
      custom,
      auto,
      platform,
      campaignContext: await resolveSchedulingCampaignContext(supabase, ownerId, parsed.data),
      supabase,
      upload_batch_id: parsed.data.upload_batch_id,
      schedule_strategy:
        parsed.data.schedule_strategy ??
        resolveDefaultInsertionStrategy({
          uploadBatchId: parsed.data.upload_batch_id,
          batchScheduledCount: parsed.data.batch_scheduled_count ?? 0,
          accountPendingCount: 0,
          mode: scheduleMode,
        }),
      client_batch_scheduled_count: parsed.data.batch_scheduled_count,
    });

    return NextResponse.json({
      ...plan,
      accounts: validAccounts.map((a) => ({
        id: a.id,
        ig_username:
          platform === "tiktok"
            ? (a as TikTokAccount).username
            : (a as InstagramAccount).ig_username,
        warmup:
          platform === "instagram"
            ? getWarmupStatus({
                warmupEnabled: (a as InstagramAccount).warmup_enabled ?? true,
                warmupStartedAt:
                  (a as InstagramAccount).warmup_started_at ?? a.created_at,
                warmupDays: (a as InstagramAccount).warmup_days ?? DEFAULT_WARMUP_DAYS,
              })
            : null,
      })),
      videos: parsed.data.items.length,
      total_posts: (parsed.data.total_count ?? parsed.data.items.length) * validAccounts.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao gerar prévia";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
