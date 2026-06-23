import type { SupabaseClient } from "@supabase/supabase-js";
import { generateBulkCaptions, generateFallbackCaptions } from "@/lib/ai/captions";
import { contentTypeForPlatform } from "@/lib/content-types";
import { accountUsername, resolveJobPlanningContext } from "@/lib/schedule-jobs/phases/context";
import { updateJobCounters, updateJobItem } from "@/lib/schedule-jobs/repository";
import { logScheduleJobEvent } from "@/lib/schedule-jobs/state";
import type { ScheduleJobItemRow, ScheduleJobRow } from "@/lib/schedule-jobs/types";

export async function processCaptionTask(
  supabase: SupabaseClient,
  ownerId: string,
  job: ScheduleJobRow,
  itemIds: string[],
) {
  if (!itemIds.length) return;

  const { data, error } = await supabase
    .from("schedule_job_items")
    .select("*")
    .eq("schedule_job_id", job.id)
    .in("id", itemIds)
    .order("sort_order", { ascending: true });

  if (error) throw new Error(error.message);

  const items = (data ?? []) as ScheduleJobItemRow[];
  const pending = items.filter((item) => !item.caption?.trim() && !item.destinations?.length);
  if (!pending.length) return;

  const ctx = await resolveJobPlanningContext(supabase, ownerId, job);
  const filenames = pending.map(
    (item, index) => item.filename ?? `video-${job.processed_items + index + 1}.mp4`,
  );

  const captionsByPlatform = new Map<string, string[]>();

  for (const target of ctx.targets) {
    const account = ctx.accounts.get(target.account_id)!;
    try {
      const { captions } = await generateBulkCaptions({
        count: pending.length,
        filenames,
        username: accountUsername(target.platform, account),
        ownerId,
        accountId: target.account_id,
        globalOffset: job.processed_items,
        platform: target.platform,
        contentType: contentTypeForPlatform(target.platform),
        campaignContext: ctx.campaignContext,
      });
      captionsByPlatform.set(target.platform, captions);
    } catch (error) {
      console.warn("[schedule-job-captions-fallback]", {
        jobId: job.id,
        platform: target.platform,
        count: pending.length,
        error: error instanceof Error ? error.message : String(error),
      });
      captionsByPlatform.set(
        target.platform,
        generateFallbackCaptions({
          count: pending.length,
          filenames,
          niche:
            ctx.campaignContext?.product?.name ??
            ctx.campaignContext?.contentObjective ??
            "conteúdo",
          platform: target.platform,
        }),
      );
    }
  }

  const primaryPlatform = ctx.insertionTarget.platform;
  const primaryCaptions = captionsByPlatform.get(primaryPlatform) ?? [];

  for (let index = 0; index < pending.length; index++) {
    const item = pending[index]!;
    const caption = primaryCaptions[index]?.trim() ?? "";
    await updateJobItem(supabase, item.id, {
      status: "processing",
      caption,
    });
  }

  const processed = Math.min(job.total_items, job.processed_items + pending.length);
  await updateJobCounters(supabase, job.id, {
    processed_items: processed,
    status: "processing",
    current_step: "captions",
  } as Partial<ScheduleJobRow>);

  logScheduleJobEvent("schedule-job-chunk", job, {
    phase: "captions",
    count: pending.length,
  });

  console.info("[schedule-job-chunk]", {
    jobId: job.id,
    phase: "captions",
    items: pending.length,
  });
}
