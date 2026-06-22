import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/meta/oauth";
import { getScheduleJobHeader } from "@/lib/schedule-jobs/repository";
import type { ScheduleJobItemRow } from "@/lib/schedule-jobs/types";
import { createAdminClient } from "@/lib/supabase/admin";
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

  const { data: posts, error: postsError } = await supabase
    .from("scheduled_posts")
    .select("id, scheduled_at, status, upload_file_id")
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
  const strategy = job.config?.schedule_strategy ?? "new_plan";
  const anchorStartDate =
    strategy === "continue" && pendingPosts[0]?.scheduled_at
      ? new Date(pendingPosts[0].scheduled_at as string)
      : undefined;

  const { context: warmupContext, plan } = buildWarmupRecalculatePlan({
    pendingCount: pendingPosts.length,
    strategy,
    anchorStartDate,
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
          plannedPosts: plan.plannedPosts,
          skippedPastSlots: plan.skippedPastSlots,
        },
      },
      updated_at: now.toISOString(),
    })
    .eq("id", id);

  return NextResponse.json({
    ok: true,
    warmupStartDate: warmupContext.warmupStartDate,
    updated: pendingPosts.length,
    before,
    after,
  });
}
