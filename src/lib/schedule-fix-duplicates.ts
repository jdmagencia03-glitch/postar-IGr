import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_WARMUP_DAYS } from "@/lib/account-warmup";
import { buildAutoTimeSlots } from "@/lib/smart-schedule";
import {
  applyWarmupRedistribution,
  previewWarmupRedistribution,
  resolveScheduleModeForAccount,
} from "@/lib/schedule-redistribute";
import {
  ACTIVE_SLOT_STATUSES,
  detectDuplicateSlots,
  fillScheduleSlots,
  type SlotOccupant,
} from "@/lib/schedule-slots";
import { fetchPendingPostsForAccount } from "@/lib/schedule-insertion";
import type { ContentType, SocialPlatform } from "@/lib/types";

export type DuplicateSlotFixPreview = {
  accountId: string;
  platform: SocialPlatform;
  duplicateGroups: ReturnType<typeof detectDuplicateSlots>;
  moves: Array<{
    postId: string;
    from: string;
    to: string;
  }>;
};

export async function previewDuplicateSlotFixes(params: {
  supabase: SupabaseClient;
  platform: SocialPlatform;
  accountId: string;
  contentType?: ContentType;
  timeSlots?: Array<{ hour: number; minute: number }>;
  postsPerDay?: number;
  scheduleMode?: "warmup" | "auto" | "custom" | "today";
}) {
  const scheduleMode =
    params.scheduleMode ??
    (await resolveScheduleModeForAccount(params.supabase, params.platform, params.accountId));

  if (scheduleMode === "warmup") {
    const warmup = await previewWarmupRedistribution({
      supabase: params.supabase,
      platform: params.platform,
      accountId: params.accountId,
      contentType: params.contentType,
      warmupDays: DEFAULT_WARMUP_DAYS,
    });

    const duplicateGroups = detectDuplicateSlots(
      (await fetchPendingPostsForAccount(
        params.supabase,
        params.platform,
        params.accountId,
        params.contentType,
      )).map((post) => ({
        id: post.id,
        scheduled_at: post.scheduled_at,
        status: post.status,
      })),
    );

    return {
      accountId: params.accountId,
      platform: params.platform,
      scheduleMode,
      duplicateGroups,
      moves: warmup.assignments
        .filter((row) => row.from !== row.to)
        .map((row) => ({ postId: row.postId, from: row.from, to: row.to })),
      dayBreakdown: warmup.dayBreakdown,
    };
  }

  const existing = await fetchPendingPostsForAccount(
    params.supabase,
    params.platform,
    params.accountId,
    params.contentType,
  );

  const duplicateGroups = detectDuplicateSlots(existing);
  const timeSlots = params.timeSlots ?? buildAutoTimeSlots(10);
  const postsPerDay = params.postsPerDay ?? 15;
  const moves: DuplicateSlotFixPreview["moves"] = [];

  for (const group of duplicateGroups) {
    const keepId = group.postIds[0];
    const toMove = group.postIds.slice(1);

    let virtualExisting: SlotOccupant[] = existing.map((post) => ({
      id: post.id,
      scheduled_at: post.scheduled_at,
      status: post.status,
    }));

    for (const postId of toMove) {
      const post = existing.find((item) => item.id === postId);
      if (!post) continue;

      const schedule = fillScheduleSlots({
        count: 1,
        existing: virtualExisting.filter((item) => item.id !== postId),
        timeSlots,
        postsPerDay,
      });

      const next = schedule[0];
      if (!next) continue;

      moves.push({
        postId,
        from: post.scheduled_at,
        to: next.toISOString(),
      });

      virtualExisting = virtualExisting.map((item) =>
        item.id === postId ? { ...item, scheduled_at: next.toISOString() } : item,
      );

      console.info("[schedule-duplicate-fix]", {
        accountId: params.accountId,
        platform: params.platform,
        postId,
        from: post.scheduled_at,
        to: next.toISOString(),
      });
    }

    void keepId;
  }

  return {
    accountId: params.accountId,
    platform: params.platform,
    scheduleMode,
    duplicateGroups,
    moves,
  } satisfies DuplicateSlotFixPreview & { scheduleMode?: string; dayBreakdown?: unknown };
}

export async function applyDuplicateSlotFixes(params: {
  supabase: SupabaseClient;
  platform: SocialPlatform;
  accountId: string;
  contentType?: ContentType;
  timeSlots?: Array<{ hour: number; minute: number }>;
  postsPerDay?: number;
  scheduleMode?: "warmup" | "auto" | "custom" | "today";
}) {
  const scheduleMode =
    params.scheduleMode ??
    (await resolveScheduleModeForAccount(params.supabase, params.platform, params.accountId));

  if (scheduleMode === "warmup") {
    await applyWarmupRedistribution({
      supabase: params.supabase,
      platform: params.platform,
      accountId: params.accountId,
      contentType: params.contentType,
      warmupDays: DEFAULT_WARMUP_DAYS,
    });
    return previewDuplicateSlotFixes({
      ...params,
      scheduleMode: "warmup",
    });
  }

  const preview = await previewDuplicateSlotFixes({
    ...params,
    scheduleMode,
  });

  for (const move of preview.moves) {
    const { error } = await params.supabase
      .from("scheduled_posts")
      .update({
        scheduled_at: move.to,
        updated_at: new Date().toISOString(),
      })
      .eq("id", move.postId)
      .in("status", [...ACTIVE_SLOT_STATUSES]);

    if (error) {
      throw new Error(`Falha ao mover post ${move.postId}: ${error.message}`);
    }
  }

  return preview;
}
