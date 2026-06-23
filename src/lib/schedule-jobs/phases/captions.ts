import type { SupabaseClient } from "@supabase/supabase-js";
import { generateBulkCaptions, generateFallbackCaptions } from "@/lib/ai/captions";
import { contentTypeForPlatform } from "@/lib/content-types";
import { SCHEDULE_JOB_MAX_ATTEMPTS } from "@/lib/schedule-jobs/constants";
import {
  buildPipelinePatch,
  captionNeedsProcessing,
  type ItemPipelineState,
} from "@/lib/schedule-jobs/item-pipeline";
import { accountUsername, resolveJobPlanningContext } from "@/lib/schedule-jobs/phases/context";
import {
  finalizeJobStatusFromDb,
  markJobInfrastructureError,
  updateJobItem,
} from "@/lib/schedule-jobs/repository";
import { PIPELINE_MIGRATION_REQUIRED, pipelineMigrationMessage } from "@/lib/schedule-jobs/pipeline-schema";
import { logScheduleJobEvent } from "@/lib/schedule-jobs/state";
import type { ScheduleJobItemRow, ScheduleJobRow } from "@/lib/schedule-jobs/types";

function splitCaptionAndHashtags(caption: string) {
  const lines = caption.split("\n");
  const hashtagLines = lines.filter((line) => /#\w+/.test(line));
  const hashtags = hashtagLines.join(" ").trim() || null;
  return { caption: caption.trim(), hashtags };
}

async function generateCaptionForItem(params: {
  item: ScheduleJobItemRow;
  ownerId: string;
  ctx: Awaited<ReturnType<typeof resolveJobPlanningContext>>;
}) {
  const { item, ownerId, ctx } = params;
  const target = ctx.insertionTarget;
  const account = ctx.accounts.get(target.account_id)!;
  const filename = item.filename ?? `video-${item.sort_order + 1}.mp4`;

  try {
    const { captions } = await generateBulkCaptions({
      count: 1,
      filenames: [filename],
      username: accountUsername(target.platform, account),
      ownerId,
      accountId: target.account_id,
      globalOffset: item.sort_order,
      platform: target.platform,
      contentType: contentTypeForPlatform(target.platform),
      campaignContext: ctx.campaignContext,
    });
    const text = captions[0]?.trim();
    if (!text) throw new Error("Legenda vazia");
    return { caption: text, source: "ai" as const };
  } catch (error) {
    console.warn("[schedule-job-caption-item-fallback]", {
      itemId: item.id,
      jobId: item.schedule_job_id,
      error: error instanceof Error ? error.message : String(error),
    });
    const fallback = generateFallbackCaptions({
      count: 1,
      filenames: [filename],
      niche:
        ctx.campaignContext?.product?.name ??
        ctx.campaignContext?.contentObjective ??
        "conteúdo",
      platform: target.platform,
    })[0]!;
    return { caption: fallback.trim(), source: "fallback" as const };
  }
}

async function markCaptionFailure(
  supabase: SupabaseClient,
  item: ScheduleJobItemRow,
  message: string,
) {
  const attempts = item.attempt_count + 1;
  const terminal = attempts >= SCHEDULE_JOB_MAX_ATTEMPTS;
  const pipeline: ItemPipelineState = {
    caption_status: terminal ? "caption_failed_persistent" : "caption_failed_retryable",
    caption_attempts: attempts,
    caption_error: message,
  };

  await updateJobItem(supabase, item.id, {
    ...buildPipelinePatch(item, pipeline),
    status: terminal ? "failed" : "retrying",
    attempt_count: attempts,
    error_message: message,
  });
}

async function applyItemUpdate(
  supabase: SupabaseClient,
  job: ScheduleJobRow,
  itemId: string,
  patch: Record<string, unknown>,
) {
  const result = await updateJobItem(supabase, itemId, patch);
  if (!result.ok && result.code === PIPELINE_MIGRATION_REQUIRED) {
    await markJobInfrastructureError(
      supabase,
      job.id,
      PIPELINE_MIGRATION_REQUIRED,
      pipelineMigrationMessage(),
    );
    return false;
  }
  return true;
}

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
  const pending = items.filter((item) => captionNeedsProcessing(item));
  if (!pending.length) {
    await finalizeJobStatusFromDb(supabase, job);
    return;
  }

  const ctx = await resolveJobPlanningContext(supabase, ownerId, job);
  let succeeded = 0;
  let failed = 0;
  let pipelineBlocked = false;

  for (const item of pending) {
    if (pipelineBlocked) break;

    const processingOk = await applyItemUpdate(supabase, job, item.id, {
      ...buildPipelinePatch(item, {
        caption_status: "caption_processing",
        caption_attempts: item.attempt_count,
      }),
      status: "processing",
    });
    if (!processingOk) {
      pipelineBlocked = true;
      break;
    }

    try {
      const generated = await generateCaptionForItem({ item, ownerId, ctx });
      const { caption, hashtags } = splitCaptionAndHashtags(generated.caption);
      const pipeline: ItemPipelineState = {
        caption_status: "caption_done",
        caption_attempts: item.attempt_count,
        caption_error: null,
        caption_source: generated.source,
        hashtags_status: hashtags ? "hashtags_done" : "hashtags_pending",
        hashtags_error: null,
      };

      const savedOk = await applyItemUpdate(supabase, job, item.id, {
        ...buildPipelinePatch(item, pipeline),
        status: "queued",
        caption,
        hashtags,
        error_message: null,
      });
      if (!savedOk) {
        pipelineBlocked = true;
        break;
      }
      succeeded += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Falha ao gerar legenda";
      await markCaptionFailure(supabase, item, message);
      failed += 1;
    }
  }
  if (pipelineBlocked) {
    await finalizeJobStatusFromDb(supabase, job);
    return;
  }

  await finalizeJobStatusFromDb(supabase, job);

  logScheduleJobEvent("schedule-job-chunk", job, {
    phase: "captions",
    count: pending.length,
    succeeded,
    failed,
  });

  console.info("[schedule-job-chunk]", {
    jobId: job.id,
    phase: "captions",
    items: pending.length,
    succeeded,
    failed,
  });
}
