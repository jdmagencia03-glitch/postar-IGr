import { NextRequest, NextResponse } from "next/server";
import { contentTypeForPlatform } from "@/lib/content-types";
import { getSessionUserId } from "@/lib/meta/oauth";
import { getScheduleJobHeader } from "@/lib/schedule-jobs/repository";
import type { ScheduleJobItemRow } from "@/lib/schedule-jobs/types";
import { createAdminClient } from "@/lib/supabase/admin";
import type { SocialPlatform } from "@/lib/types";
import { buildWarmupRecalculatePlan } from "@/lib/warmup-diagnostics";

export const dynamic = "force-dynamic";

const ACTIVE_POST_STATUSES = ["pending", "processing", "retrying"];

/** Recalcula horários de posts pendentes no modo Aquecimento. */
export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const ownerId = await getSessionUserId();
  if (!ownerId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const { id } = await context.params;
  const supabase = createAdminClient();

  const job = await getScheduleJobHeader(supabase, ownerId, id);
  if (!job) return NextResponse.json({ error: "Job não encontrado" }, { status: 404 });
  if (job.schedule_mode !== "warmup") {
    return NextResponse.json({ error: "job_not_warmup" }, { status: 400 });
  }
  if (!job.upload_batch_id) {
    return NextResponse.json({ error: "job_missing_batch" }, { status: 400 });
  }

  const platform = (job.platform === "tiktok" ? "tiktok" : "instagram") as SocialPlatform;
  const accountId =
    platform === "tiktok" ? job.tiktok_account_id : job.account_id;
  if (!accountId) {
    return NextResponse.json({ error: "job_missing_account" }, { status: 400 });
  }

  const { data: posts, error: postsError } = await supabase
    .from("scheduled_posts")
    .select("id, scheduled_at, status")
    .eq("upload_batch_id", job.upload_batch_id)
    .in("status", ACTIVE_POST_STATUSES)
    .order("scheduled_at", { ascending: true });

  if (postsError) {
    return NextResponse.json({ error: postsError.message }, { status: 500 });
  }

  const pendingPosts = posts ?? [];
  if (!pendingPosts.length) {
    return NextResponse.json({ ok: true, updated: 0, before: [], after: [] });
  }

  const { data: items } = await supabase
    .from("schedule_job_items")
    .select("*")
    .eq("schedule_job_id", id)
    .order("sort_order", { ascending: true });

  const jobItems = (items ?? []) as ScheduleJobItemRow[];
  const now = new Date();
  const excludePostIds = pendingPosts.map((post) => post.id as string);
  const contentType = contentTypeForPlatform(platform);

  const { context: warmupContext, plan, planningMeta } = await buildWarmupRecalculatePlan({
    supabase,
    accountId,
    platform,
    contentType,
    pendingCount: pendingPosts.length,
    excludePostIds,
    now,
  });

  if (plan.schedule.length < pendingPosts.length) {
    return NextResponse.json({ error: "insufficient_warmup_slots" }, { status: 500 });
  }

  const before: Array<{ postId: string; scheduledAt: string }> = [];
  const after: Array<{ postId: string; scheduledAt: string }> = [];

  for (let index = 0; index < pendingPosts.length; index++) {
    const post = pendingPosts[index]!;
    const nextAt = plan.schedule[index]!.toISOString();
    before.push({ postId: post.id as string, scheduledAt: post.scheduled_at as string });
    after.push({ postId: post.id as string, scheduledAt: nextAt });

    await supabase
      .from("scheduled_posts")
      .update({ scheduled_at: nextAt, updated_at: now.toISOString() })
      .eq("id", post.id)
      .in("status", ACTIVE_POST_STATUSES);
  }

  for (let index = 0; index < jobItems.length; index++) {
    const item = jobItems[index]!;
    const nextAt = plan.schedule[index]?.toISOString();
    if (!nextAt || !item.destinations?.length) continue;

    const destinations = item.destinations.map((dest) => ({
      ...dest,
      scheduled_at: nextAt,
    }));

    await supabase
      .from("schedule_job_items")
      .update({
        destinations,
        scheduled_at: nextAt,
        updated_at: now.toISOString(),
      })
      .eq("id", item.id);
  }

  await supabase
    .from("schedule_jobs")
    .update({
      config: {
        ...job.config,
        schedule_plan: {
          ...job.config?.schedule_plan,
          warmupStartDate: warmupContext.warmupStartDate,
          nowUsedForPlanning: now.toISOString(),
          plannedPosts: plan.plannedPosts,
          skippedPastSlots: plan.skippedPastSlots,
          planningMeta,
        },
      },
      updated_at: now.toISOString(),
    })
    .eq("id", id);

  return NextResponse.json({
    ok: true,
    warmupStartDate: warmupContext.warmupStartDate,
    updated: pendingPosts.length,
    planningMeta,
    before,
    after,
  });
}
