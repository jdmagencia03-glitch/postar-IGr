import { formatZodError } from "@/lib/api-errors";
import { getSessionUserId } from "@/lib/meta/oauth";
import {
  countBatchScheduledPosts,
  fetchPendingPostsForAccount,
  resolveDefaultInsertionStrategy,
  shouldShowInsertionStrategyPicker,
  type ScheduleInsertionStrategy,
} from "@/lib/schedule-insertion";
import { contentTypeForPlatform } from "@/lib/content-types";
import { createAdminClient } from "@/lib/supabase/admin";
import { getOwnerAccountById } from "@/lib/accounts";
import { getOwnerTikTokAccountById } from "@/lib/tiktok/accounts";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const contextSchema = z.object({
  platform: z.enum(["instagram", "tiktok"]),
  account_id: z.string().uuid(),
  upload_batch_id: z.string().uuid().optional().nullable(),
  schedule_mode: z.enum(["today", "auto", "warmup", "custom"]).optional(),
  batch_scheduled_count: z.number().int().min(0).optional(),
});

export async function POST(request: NextRequest) {
  const ownerId = await getSessionUserId();
  if (!ownerId) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const body = await request.json();
  const parsed = contextSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { platform, account_id: accountId } = parsed.data;

  if (platform === "tiktok") {
    const account = await getOwnerTikTokAccountById(supabase, ownerId, accountId);
    if (!account) {
      return NextResponse.json({ error: "Conta TikTok não encontrada" }, { status: 404 });
    }
  } else {
    const account = await getOwnerAccountById(supabase, ownerId, accountId);
    if (!account) {
      return NextResponse.json({ error: "Conta Instagram não encontrada" }, { status: 404 });
    }
  }

  const scheduleMode = parsed.data.schedule_mode ?? "auto";
  const contentType = contentTypeForPlatform(platform);

  const existing = await fetchPendingPostsForAccount(
    supabase,
    platform,
    accountId,
    contentType,
  );

  const dbBatchScheduled = countBatchScheduledPosts(existing, parsed.data.upload_batch_id);
  const batchScheduledCount = Math.max(
    dbBatchScheduled,
    parsed.data.batch_scheduled_count ?? 0,
  );
  const accountPendingCount = existing.length;
  const defaultStrategy = resolveDefaultInsertionStrategy({
    uploadBatchId: parsed.data.upload_batch_id,
    batchScheduledCount,
    accountPendingCount,
    mode: scheduleMode,
  });
  const showStrategyPicker = shouldShowInsertionStrategyPicker({
    batchScheduledCount,
    accountPendingCount,
  });

  return NextResponse.json({
    batch_scheduled_count: batchScheduledCount,
    account_pending_count: accountPendingCount,
    default_strategy: defaultStrategy satisfies ScheduleInsertionStrategy,
    show_strategy_picker: showStrategyPicker,
  });
}
