import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DEFAULT_WARMUP_DAYS,
  generateWarmupSchedule,
  groupWarmupScheduleByDay,
} from "@/lib/account-warmup";
import { TIKTOK_SCHEDULE_OFFSET_MINUTES } from "@/lib/multiplatform/types";
import { fetchPendingPostsForAccount } from "@/lib/schedule-insertion";
import { ensureFutureScheduleSlot } from "@/lib/smart-schedule";
import type { ContentType, SocialPlatform } from "@/lib/types";

export type ScheduleModeKind = "warmup" | "auto" | "custom" | "today";

export async function resolveScheduleModeForAccount(
  supabase: SupabaseClient,
  platform: SocialPlatform,
  accountId: string,
): Promise<ScheduleModeKind> {
  const accountCol = platform === "tiktok" ? "tiktok_account_id" : "account_id";

  const { data: batches } = await supabase
    .from("upload_batches")
    .select("schedule_mode")
    .eq("platform", platform)
    .eq(accountCol, accountId)
    .order("created_at", { ascending: false })
    .limit(10);

  if (batches?.length) {
    const modes = batches.map((row) => row.schedule_mode as ScheduleModeKind);
    if (modes.filter((mode) => mode === "warmup").length >= Math.ceil(modes.length / 2)) {
      return "warmup";
    }
    if (modes.includes("custom")) return "custom";
    if (modes.includes("today")) return "today";
  }

  const jobCol = platform === "tiktok" ? "tiktok_account_id" : "account_id";
  const { data: jobs } = await supabase
    .from("schedule_jobs")
    .select("schedule_mode")
    .eq(jobCol, accountId)
    .order("created_at", { ascending: false })
    .limit(5);

  const jobMode = jobs?.[0]?.schedule_mode as ScheduleModeKind | undefined;
  if (jobMode === "warmup" || jobMode === "custom" || jobMode === "today") {
    return jobMode;
  }

  return "auto";
}

function applyPlatformScheduleOffset(date: Date, platform: SocialPlatform) {
  if (platform !== "tiktok") return date;
  return ensureFutureScheduleSlot(
    new Date(date.getTime() + TIKTOK_SCHEDULE_OFFSET_MINUTES * 60_000),
  );
}

export type WarmupRedistributeAssignment = {
  postId: string;
  from: string;
  to: string;
};

export async function previewWarmupRedistribution(params: {
  supabase: SupabaseClient;
  platform: SocialPlatform;
  accountId: string;
  contentType?: ContentType;
  warmupDays?: number;
  warmupDayOffset?: number;
  now?: Date;
  /** Quando true, exclui posts com scheduled_at no passado. */
  onlyFuture?: boolean;
  /** Ancora o plano no horário do post (default: primeiro na ordem de criação). */
  anchorMode?: "first_in_order" | "earliest_scheduled";
}) {
  const now = params.now ?? new Date();
  let existing = await fetchPendingPostsForAccount(
    params.supabase,
    params.platform,
    params.accountId,
    params.contentType,
  );

  if (params.onlyFuture) {
    existing = existing.filter((post) => new Date(post.scheduled_at) >= now);
  }

  const sorted = [...existing].sort((a, b) => {
    const aCreated = new Date(a.created_at ?? a.scheduled_at).getTime();
    const bCreated = new Date(b.created_at ?? b.scheduled_at).getTime();
    if (aCreated !== bCreated) return aCreated - bCreated;
    return a.id.localeCompare(b.id);
  });

  if (!sorted.length) {
    return {
      accountId: params.accountId,
      platform: params.platform,
      mode: "warmup" as const,
      postCount: 0,
      assignments: [] as WarmupRedistributeAssignment[],
      dayBreakdown: [],
    };
  }

  const anchorMode = params.anchorMode ?? "first_in_order";
  const anchorSource =
    anchorMode === "earliest_scheduled"
      ? [...sorted].sort(
          (a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime(),
        )[0]
      : sorted[0];
  const firstScheduledAt = new Date(anchorSource.scheduled_at);
  const baseSchedule = generateWarmupSchedule({
    count: sorted.length,
    warmupDays: params.warmupDays ?? DEFAULT_WARMUP_DAYS,
    warmupDayOffset: params.warmupDayOffset ?? 0,
    firstScheduledAt,
    now,
  });

  const schedule = baseSchedule.map((slot) =>
    applyPlatformScheduleOffset(slot, params.platform),
  );

  const assignments: WarmupRedistributeAssignment[] = sorted.map((post, index) => ({
    postId: post.id,
    from: post.scheduled_at,
    to: schedule[index]?.toISOString() ?? post.scheduled_at,
  }));

  return {
    accountId: params.accountId,
    platform: params.platform,
    mode: "warmup" as const,
    postCount: sorted.length,
    assignments,
    dayBreakdown: groupWarmupScheduleByDay(schedule),
  };
}

export async function applyWarmupRedistribution(params: {
  supabase: SupabaseClient;
  platform: SocialPlatform;
  accountId: string;
  contentType?: ContentType;
  warmupDays?: number;
  warmupDayOffset?: number;
}) {
  const preview = await previewWarmupRedistribution(params);

  for (const assignment of preview.assignments) {
    if (assignment.from === assignment.to) continue;

    const { error } = await params.supabase
      .from("scheduled_posts")
      .update({
        scheduled_at: assignment.to,
        updated_at: new Date().toISOString(),
      })
      .eq("id", assignment.postId);

    if (error) {
      throw new Error(`Falha ao reagendar post ${assignment.postId}: ${error.message}`);
    }

    console.info("[schedule-warmup-redistribute]", {
      accountId: params.accountId,
      platform: params.platform,
      postId: assignment.postId,
      from: assignment.from,
      to: assignment.to,
    });
  }

  return preview;
}
