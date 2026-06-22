import { randomUUID } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { mergeCampaignFields, resolveSchedulingCampaignContext } from "@/lib/campaigns/context";
import { contentTypeForPlatform } from "@/lib/content-types";
import { reportClientOperationalError } from "@/lib/operations/operational-errors";
import { filterDuplicateScheduleRows } from "@/lib/publish/schedule-guard";
import { SCHEDULE_JOB_MAX_ATTEMPTS } from "@/lib/schedule-jobs/constants";
import { updateJobItem } from "@/lib/schedule-jobs/repository";
import { logScheduleJobEvent } from "@/lib/schedule-jobs/state";
import type {
  ScheduleJobConfig,
  ScheduleJobDestination,
  ScheduleJobItemRow,
  ScheduleJobRow,
} from "@/lib/schedule-jobs/types";
import {
  resolveWarmupScheduleContext,
  validateWarmupScheduledAt,
} from "@/lib/account-warmup";
import { sanitizeScheduledAt } from "@/lib/smart-schedule";
import { getBatchForOwner, refreshBatchCounters } from "@/lib/upload/batches";
import { validateScheduledMediaUrls } from "@/lib/storage/schedule-media-guard";

async function markUploadFilesScheduled(
  supabase: SupabaseClient,
  ownerId: string,
  batchId: string,
  publicUrls: string[],
) {
  const batch = await getBatchForOwner(supabase, ownerId, batchId);
  if (!batch) return;

  const urlSet = new Set(publicUrls);
  const fileIds =
    batch.upload_files
      ?.filter((file) => file.public_url && urlSet.has(file.public_url))
      .map((file) => file.id) ?? [];

  if (!fileIds.length) return;

  await supabase
    .from("upload_files")
    .update({ removed: true, updated_at: new Date().toISOString() })
    .in("id", fileIds)
    .eq("batch_id", batchId);

  await refreshBatchCounters(supabase, batchId);
}

export async function processInsertChunkForItems(
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

  const pending = (data ?? []) as ScheduleJobItemRow[];
  const config = job.config as ScheduleJobConfig;
  const isWarmupMode = config.schedule_mode === "warmup";
  const warmupStartDate =
    config.schedule_plan?.warmupStartDate ??
    resolveWarmupScheduleContext({
      strategy: config.schedule_strategy ?? "new_plan",
      now: new Date(),
    }).warmupStartDate;
  const campaignContext = await resolveSchedulingCampaignContext(supabase, ownerId, {
    product_id: config.product_id,
    campaign_id: config.campaign_id,
    content_objective: config.content_objective,
  });
  const campaignFields = mergeCampaignFields(campaignContext);
  const scheduledUrls: string[] = [];

  for (const item of pending) {
    if (!item.destinations?.length) continue;

    if (
      (item.status === "completed" && item.created_post_id) ||
      item.created_post_id ||
      item.destinations.every((dest) => dest.created_post_id)
    ) {
      console.info("[schedule-job-idempotency]", {
        jobId: job.id,
        itemId: item.id,
        uploadFileId: item.upload_file_id,
      });
      if (item.status !== "completed") {
        await updateJobItem(supabase, item.id, {
          status: "completed",
          created_post_id: item.created_post_id ?? item.destinations[0]?.created_post_id ?? null,
        });
      }
      continue;
    }

    try {
      const mediaCheck = await validateScheduledMediaUrls({
        supabase,
        ownerId,
        urls: item.media_urls,
        uploadFileId: item.upload_file_id,
      });
      if (!mediaCheck.ok) {
        await updateJobItem(supabase, item.id, {
          status: "failed",
          error_message: `${mediaCheck.code}: ${mediaCheck.message}`,
          attempt_count: item.attempt_count + 1,
        });
        continue;
      }

      const rows = item.destinations
        .filter((dest) => !dest.created_post_id)
        .map((dest) => {
          const scheduledAt = isWarmupMode
            ? dest.scheduled_at
            : sanitizeScheduledAt(dest.scheduled_at);

          if (isWarmupMode) {
            const validation = validateWarmupScheduledAt(scheduledAt, warmupStartDate);
            if (!validation.ok) {
              throw new Error(
                `invalid_warmup_slot: ${JSON.stringify({
                  invalidSlot: validation.invalidSlot,
                  dayIndex: validation.dayIndex,
                  allowedSlots: validation.allowedSlots,
                })}`,
              );
            }
          }

          return {
            platform: dest.platform,
            account_id: dest.platform === "instagram" ? dest.account_id : null,
            tiktok_account_id: dest.platform === "tiktok" ? dest.account_id : null,
            content_type: contentTypeForPlatform(dest.platform),
            media_type: "REELS" as const,
            media_urls: item.media_urls,
            media_asset_id: mediaCheck.mediaAssetIds[0] ?? null,
            caption: dest.caption?.trim() || null,
            scheduled_at: scheduledAt,
            product_id: campaignFields.product_id,
            campaign_id: campaignFields.campaign_id,
            content_objective: campaignFields.content_objective,
            upload_batch_id: job.upload_batch_id,
            parent_publish_group_id: item.parent_publish_group_id ?? randomUUID(),
          };
        });

      if (!rows.length) {
        continue;
      }

      const { accepted, skipped } = await filterDuplicateScheduleRows(supabase, rows);
      const postIds: string[] = [];

      if (accepted.length) {
        const { data: inserted, error: insertError } = await supabase
          .from("scheduled_posts")
          .insert(accepted)
          .select("id");
        if (insertError) throw new Error(insertError.message);
        for (const post of inserted ?? []) {
          postIds.push(post.id);
        }
      }

      for (const skip of skipped) {
        postIds.push(skip.existing_id);
      }

      if (!postIds.length) {
        await updateJobItem(supabase, item.id, {
          status: "retrying",
          error_message: "Nenhum post foi criado neste item",
          attempt_count: item.attempt_count + 1,
        });
        continue;
      }

      const updatedDestinations = item.destinations.map((dest, index) => ({
        ...dest,
        created_post_id: dest.created_post_id ?? postIds[index] ?? postIds[0] ?? null,
      }));

      await updateJobItem(supabase, item.id, {
        status: "completed",
        destinations: updatedDestinations as ScheduleJobDestination[],
        created_post_id: postIds[0] ?? null,
        error_message: skipped.length ? "Alguns destinos já estavam agendados (reaproveitados)." : null,
      });

      scheduledUrls.push(...item.media_urls);

      console.info("[schedule-job-chunk]", {
        jobId: job.id,
        phase: "save_posts",
        itemId: item.id,
        posts: postIds.length,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Falha ao inserir post";
      const attempts = item.attempt_count + 1;
      await updateJobItem(supabase, item.id, {
        status: attempts >= SCHEDULE_JOB_MAX_ATTEMPTS ? "failed" : "retrying",
        error_message: message,
        attempt_count: attempts,
      });

      if (attempts >= SCHEDULE_JOB_MAX_ATTEMPTS) {
        try {
          await reportClientOperationalError(supabase, ownerId, {
            errorType: "schedule_chunk_failed",
            title: "Falha ao agendar vídeo",
            message: `${item.filename}: ${message}`,
            probableCause: "Timeout, rede ou limite da API.",
            recommendedAction: "Retome o agendamento — posts já criados não serão duplicados.",
            uploadBatchId: job.upload_batch_id ?? undefined,
            metadata: { jobId: job.id, itemId: item.id, filename: item.filename },
          });
        } catch {
          // ignore
        }
      }
    }
  }

  if (job.upload_batch_id && scheduledUrls.length) {
    await markUploadFilesScheduled(supabase, ownerId, job.upload_batch_id, scheduledUrls).catch(
      () => undefined,
    );
  }

  logScheduleJobEvent("schedule-job-chunk", job, {
    phase: "save_posts",
    count: pending.length,
  });
}
