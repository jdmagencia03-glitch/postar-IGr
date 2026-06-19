import { formatZodError } from "@/lib/api-errors";
import { NextRequest, NextResponse } from "next/server";
import { getOwnerAccountById } from "@/lib/accounts";
import {
  DEFAULT_WARMUP_DAYS,
  getWarmupDayOffset,
  resolveAutoScheduleOptions,
  type AutoAccountProfile,
} from "@/lib/account-warmup";
import { getSessionUserId } from "@/lib/meta/oauth";
import { buildMultiplatformPlan } from "@/lib/multiplatform/plan";
import type { PublishTarget } from "@/lib/multiplatform/types";
import { parseCustomSchedulePayload } from "@/lib/smart-schedule";
import { getOwnerTikTokAccountById } from "@/lib/tiktok/accounts";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveSchedulingCampaignContext } from "@/lib/campaigns/context";
import { resolveDefaultInsertionStrategy } from "@/lib/schedule-insertion";
import { validateMediaUrlsForOwner } from "@/lib/security/ownership";
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
    targets: z
      .array(
        z.object({
          platform: z.enum(["instagram", "tiktok"]),
          account_id: z.string().uuid(),
        }),
      )
      .min(1)
      .max(2),
    schedule_mode: z.enum(["today", "auto", "warmup", "custom"]).optional(),
    auto_profile: z.enum(["new", "growing", "strong"]).optional(),
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
      .max(50),
  })
  .refine(
    (data) => data.schedule_mode !== "custom" || Boolean(data.custom_schedule),
    { message: "Informe horários no modo personalizado", path: ["custom_schedule"] },
  )
  .refine((data) => {
    const platforms = new Set(data.targets.map((t) => t.platform));
    return platforms.size === data.targets.length;
  }, { message: "Selecione uma conta por plataforma", path: ["targets"] });

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

  const scheduleMode = parsed.data.schedule_mode ?? "auto";

  const supabase = createAdminClient();
  const accounts = new Map<string, InstagramAccount | TikTokAccount>();

  for (const target of parsed.data.targets) {
    if (target.platform === "tiktok") {
      const account = await getOwnerTikTokAccountById(supabase, ownerId, target.account_id);
      if (!account) {
        return NextResponse.json({ error: "Conta TikTok não encontrada" }, { status: 404 });
      }
      accounts.set(target.account_id, account);
    } else {
      const account = await getOwnerAccountById(supabase, ownerId, target.account_id);
      if (!account) {
        return NextResponse.json({ error: "Conta Instagram não encontrada" }, { status: 404 });
      }
      accounts.set(target.account_id, account);
    }
  }

  for (const item of parsed.data.items) {
    const mediaCheck = validateMediaUrlsForOwner(item.media_urls, ownerId);
    if (!mediaCheck.ok) {
      return NextResponse.json({ error: mediaCheck.error }, { status: 403 });
    }
  }

  const custom =
    scheduleMode === "custom" && parsed.data.custom_schedule
      ? parseCustomSchedulePayload(parsed.data.custom_schedule)
      : undefined;

  if (scheduleMode === "custom" && (!custom || !custom.timeSlots.length)) {
    return NextResponse.json({ error: "Horários inválidos no modo personalizado." }, { status: 400 });
  }

  let warmup: { warmupDays?: number; warmupDayOffset?: number } | undefined;
  const igTarget = parsed.data.targets.find((t) => t.platform === "instagram");
  const igAccount = igTarget ? (accounts.get(igTarget.account_id) as InstagramAccount) : null;

  if (scheduleMode === "warmup") {
    if (igAccount) {
      warmup = {
        warmupDays: igAccount.warmup_days ?? DEFAULT_WARMUP_DAYS,
        warmupDayOffset: getWarmupDayOffset(
          igAccount.warmup_started_at ?? igAccount.created_at,
        ),
      };
    } else {
      warmup = {
        warmupDays: DEFAULT_WARMUP_DAYS,
        warmupDayOffset: 0,
      };
    }
  }

  const auto =
    scheduleMode === "auto"
      ? resolveAutoScheduleOptions({
          profile: parsed.data.auto_profile as AutoAccountProfile | undefined,
          igAccount,
        })
      : undefined;

  try {
    const campaignContext = await resolveSchedulingCampaignContext(supabase, ownerId, parsed.data);

    const tiktokTarget = parsed.data.targets.find((t) => t.platform === "tiktok");
    const insertionPlatform = igTarget ? ("instagram" as const) : ("tiktok" as const);
    const insertionAccountId = igTarget?.account_id ?? tiktokTarget!.account_id;
    const scheduleStrategy =
      parsed.data.schedule_strategy ??
      resolveDefaultInsertionStrategy({
        uploadBatchId: parsed.data.upload_batch_id,
        batchScheduledCount: parsed.data.batch_scheduled_count ?? 0,
        accountPendingCount: 0,
        mode: scheduleMode,
      });

    const plan = await buildMultiplatformPlan({
      items: parsed.data.items,
      targets: parsed.data.targets as PublishTarget[],
      accounts,
      ownerId,
      schedule_mode: scheduleMode,
      batch_offset: parsed.data.batch_offset,
      total_count: parsed.data.total_count ?? parsed.data.items.length,
      warmup,
      custom,
      auto,
      campaignContext,
      supabase,
      upload_batch_id: parsed.data.upload_batch_id,
      schedule_strategy: scheduleStrategy,
      client_batch_scheduled_count: parsed.data.batch_scheduled_count,
      insertion_account_id: insertionAccountId,
      insertion_platform: insertionPlatform,
    });

    return NextResponse.json(plan);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao gerar prévia";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
