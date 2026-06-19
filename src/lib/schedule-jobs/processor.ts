import { randomUUID } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DEFAULT_WARMUP_DAYS,
  getWarmupDayOffset,
  resolveAutoScheduleOptions,
  type AutoAccountProfile,
} from "@/lib/account-warmup";
import { getOwnerAccountById } from "@/lib/accounts";
import { mergeCampaignFields, resolveSchedulingCampaignContext } from "@/lib/campaigns/context";
import { contentTypeForPlatform } from "@/lib/content-types";
import { buildMultiplatformPlan } from "@/lib/multiplatform/plan";
import type { PublishTarget } from "@/lib/multiplatform/types";
import { filterDuplicateScheduleRows } from "@/lib/publish/schedule-guard";
import { reportClientOperationalError } from "@/lib/operations/operational-errors";
import { parseCustomSchedulePayload } from "@/lib/smart-schedule";
import { sanitizeScheduledAt } from "@/lib/smart-schedule";
import { getOwnerTikTokAccountById } from "@/lib/tiktok/accounts";
import {
  SCHEDULE_JOB_INSERT_CHUNK,
  SCHEDULE_JOB_MAX_ATTEMPTS,
  SCHEDULE_JOB_PLAN_CHUNK,
} from "@/lib/schedule-jobs/constants";
import {
  buildJobStatus,
  getScheduleJob,
  refreshJobStatusFromItems,
  updateJobCounters,
  updateJobItem,
} from "@/lib/schedule-jobs/repository";
import type {
  ScheduleJobConfig,
  ScheduleJobDestination,
  ScheduleJobItemRow,
  ScheduleJobRow,
} from "@/lib/schedule-jobs/types";
import { getBatchForOwner, refreshBatchCounters } from "@/lib/upload/batches";
import type { InstagramAccount, TikTokAccount } from "@/lib/types";
import { validateMediaUrlsForOwner } from "@/lib/security/ownership";

async function loadAccountsMap(
  supabase: SupabaseClient,
  ownerId: string,
  targets: PublishTarget[],
) {
  const accounts = new Map<string, InstagramAccount | TikTokAccount>();
  for (const target of targets) {
    if (accounts.has(target.account_id)) continue;
    if (target.platform === "tiktok") {
      const account = await getOwnerTikTokAccountById(supabase, ownerId, target.account_id);
      if (!account) throw new Error(`Conta TikTok não encontrada: ${target.account_id}`);
      accounts.set(target.account_id, account);
    } else {
      const account = await getOwnerAccountById(supabase, ownerId, target.account_id);
      if (!account) throw new Error(`Conta não encontrada: ${target.account_id}`);
      accounts.set(target.account_id, account);
    }
  }
  return accounts;
}

function resolveWarmup(
  scheduleMode: string,
  insertionPlatform: string,
  primaryAccount: InstagramAccount | TikTokAccount,
) {
  if (scheduleMode !== "warmup") return undefined;
  if (insertionPlatform === "instagram") {
    const ig = primaryAccount as InstagramAccount;
    return {
      warmupDays: ig.warmup_days ?? DEFAULT_WARMUP_DAYS,
      warmupDayOffset: getWarmupDayOffset(ig.warmup_started_at ?? ig.created_at),
    };
  }
  return { warmupDays: DEFAULT_WARMUP_DAYS, warmupDayOffset: 0 };
}

async function processPlanChunk(
  supabase: SupabaseClient,
  ownerId: string,
  job: ScheduleJobRow,
  items: ScheduleJobItemRow[],
) {
  const config = job.config as ScheduleJobConfig;
  const targets = config.targets ?? [];
  if (!targets.length) throw new Error("Nenhum destino configurado no job");

  const pending = items
    .filter((item) => !item.destinations?.length && item.status !== "failed")
    .sort((a, b) => a.sort_order - b.sort_order)
    .slice(0, SCHEDULE_JOB_PLAN_CHUNK);

  if (!pending.length) return items;

  const accounts = await loadAccountsMap(supabase, ownerId, targets);
  const insertionTarget = targets[0]!;
  const primaryAccount = accounts.get(insertionTarget.account_id)!;

  const scheduleMode = config.schedule_mode ?? "auto";
  const custom =
    scheduleMode === "custom" && config.custom_schedule
      ? parseCustomSchedulePayload(config.custom_schedule)
      : undefined;

  const auto =
    scheduleMode === "auto"
      ? resolveAutoScheduleOptions({
          profile: config.auto_profile as AutoAccountProfile | undefined,
          igAccount:
            insertionTarget.platform === "instagram"
              ? (primaryAccount as InstagramAccount)
              : null,
        })
      : undefined;

  const campaignContext = await resolveSchedulingCampaignContext(supabase, ownerId, {
    product_id: config.product_id,
    campaign_id: config.campaign_id,
    content_objective: config.content_objective,
  });

  const batchOffset = pending[0]!.sort_order;
  const planItems = pending.map((item) => ({
    media_urls: item.media_urls,
    filename: item.filename,
  }));

  const plan = await buildMultiplatformPlan({
    items: planItems,
    targets,
    accounts,
    ownerId,
    schedule_mode: scheduleMode,
    batch_offset: batchOffset,
    total_count: items.length,
    warmup: resolveWarmup(scheduleMode, insertionTarget.platform, primaryAccount),
    custom,
    auto,
    campaignContext,
    supabase,
    upload_batch_id: job.upload_batch_id,
    schedule_strategy: config.schedule_strategy,
    client_batch_scheduled_count: config.batch_scheduled_count ?? 0,
    insertion_account_id: insertionTarget.account_id,
    insertion_platform: insertionTarget.platform,
  });

  for (let index = 0; index < pending.length; index++) {
    const item = pending[index]!;
    const preview = plan.preview[index];
    if (!preview) continue;

    const destinations: ScheduleJobDestination[] = preview.destinations.map((dest) => ({
      platform: dest.platform,
      account_id: dest.account_id,
      caption: dest.caption,
      scheduled_at: dest.scheduled_at,
      created_post_id: null,
    }));

    await updateJobItem(supabase, item.id, {
      status: "processing",
      destinations,
      parent_publish_group_id: preview.parent_publish_group_id,
      scheduled_at: destinations[0]?.scheduled_at ?? null,
      caption: destinations[0]?.caption ?? null,
    });

    const itemIndex = items.findIndex((row) => row.id === item.id);
    if (itemIndex >= 0) {
      items[itemIndex] = {
        ...items[itemIndex]!,
        destinations,
        status: "processing",
        parent_publish_group_id: preview.parent_publish_group_id,
      };
    }
  }

  if (!job.schedule_summary && plan.schedule_summary) {
    await updateJobCounters(supabase, job.id, {
      schedule_summary: plan.schedule_summary,
      status: "processing",
      current_step: "captions",
    } as Partial<ScheduleJobRow>);
  }

  return items;
}

async function processInsertChunk(
  supabase: SupabaseClient,
  ownerId: string,
  job: ScheduleJobRow,
  items: ScheduleJobItemRow[],
) {
  const config = job.config as ScheduleJobConfig;
  const campaignContext = await resolveSchedulingCampaignContext(supabase, ownerId, {
    product_id: config.product_id,
    campaign_id: config.campaign_id,
    content_objective: config.content_objective,
  });
  const campaignFields = mergeCampaignFields(campaignContext);

  const pending = items
    .filter(
      (item) =>
        item.destinations?.length &&
        item.status !== "completed" &&
        item.status !== "failed",
    )
    .filter((item) => !item.destinations!.every((d) => d.created_post_id))
    .sort((a, b) => a.sort_order - b.sort_order)
    .slice(0, SCHEDULE_JOB_INSERT_CHUNK);

  const scheduledUrls: string[] = [];

  for (const item of pending) {
    if (!item.destinations?.length) continue;

    try {
      const mediaCheck = validateMediaUrlsForOwner(item.media_urls, ownerId);
      if (!mediaCheck.ok) {
        await updateJobItem(supabase, item.id, {
          status: "failed",
          error_message: mediaCheck.error ?? "Mídia inválida",
          attempt_count: item.attempt_count + 1,
        });
        continue;
      }

      const rows = item.destinations
        .filter((dest) => !dest.created_post_id)
        .map((dest) => ({
          platform: dest.platform,
          account_id: dest.platform === "instagram" ? dest.account_id : null,
          tiktok_account_id: dest.platform === "tiktok" ? dest.account_id : null,
          content_type: contentTypeForPlatform(dest.platform),
          media_type: "REELS" as const,
          media_urls: item.media_urls,
          caption: dest.caption?.trim() || null,
          scheduled_at: sanitizeScheduledAt(dest.scheduled_at),
          product_id: campaignFields.product_id,
          campaign_id: campaignFields.campaign_id,
          content_objective: campaignFields.content_objective,
          upload_batch_id: job.upload_batch_id,
          parent_publish_group_id: item.parent_publish_group_id ?? randomUUID(),
        }));

      if (!rows.length) {
        await updateJobItem(supabase, item.id, { status: "completed" });
        continue;
      }

      const { accepted, skipped } = await filterDuplicateScheduleRows(supabase, rows);
      const postIds: string[] = [];

      if (accepted.length) {
        const { data, error } = await supabase.from("scheduled_posts").insert(accepted).select("id, platform, account_id, tiktok_account_id");
        if (error) throw new Error(error.message);
        for (const post of data ?? []) {
          postIds.push(post.id);
        }
      }

      for (const skip of skipped) {
        postIds.push(skip.existing_id);
      }

      const updatedDestinations = item.destinations.map((dest, index) => ({
        ...dest,
        created_post_id: dest.created_post_id ?? postIds[index] ?? postIds[0] ?? null,
      }));

      await updateJobItem(supabase, item.id, {
        status: "completed",
        destinations: updatedDestinations,
        created_post_id: postIds[0] ?? null,
        error_message: skipped.length ? "Alguns destinos já estavam agendados (reaproveitados)." : null,
      });

      scheduledUrls.push(...item.media_urls);

      const itemIndex = items.findIndex((row) => row.id === item.id);
      if (itemIndex >= 0) {
        items[itemIndex] = {
          ...items[itemIndex]!,
          status: "completed",
          destinations: updatedDestinations,
        };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao inserir post";
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
          // tabela operational_errors pode não existir
        }
      }
    }
  }

  if (job.upload_batch_id && scheduledUrls.length) {
    await markUploadFilesScheduled(supabase, ownerId, job.upload_batch_id, scheduledUrls).catch(
      () => undefined,
    );
  }

  return items;
}

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

export async function advanceScheduleJob(
  supabase: SupabaseClient,
  ownerId: string,
  jobId: string,
) {
  const loaded = await getScheduleJob(supabase, ownerId, jobId);
  if (!loaded) throw new Error("Job não encontrado");

  let { job, items } = loaded;

  if (job.status === "completed" || job.status === "cancelled") {
    return buildJobStatus(job, items);
  }

  await updateJobCounters(supabase, job.id, {
    status: "processing",
    current_step: items.some((i) => i.destinations?.length) ? "inserting" : "captions",
  } as Partial<ScheduleJobRow>);

  const needsPlan = items.some((item) => !item.destinations?.length && item.status !== "failed");

  if (needsPlan) {
    await updateJobCounters(supabase, job.id, { current_step: "captions" } as Partial<ScheduleJobRow>);
    items = await processPlanChunk(supabase, ownerId, job, items);
  } else {
    await updateJobCounters(supabase, job.id, { current_step: "inserting" } as Partial<ScheduleJobRow>);
    items = await processInsertChunk(supabase, ownerId, job, items);
  }

  job = await refreshJobStatusFromItems(supabase, job, items);

  const stillNeedsPlan = items.some((item) => !item.destinations?.length && item.status !== "failed");
  const stillNeedsInsert = items.some(
    (item) =>
      item.destinations?.length &&
      item.status !== "completed" &&
      item.status !== "failed" &&
      !item.destinations.every((d) => d.created_post_id),
  );

  if (!stillNeedsPlan && stillNeedsInsert && job.current_step !== "inserting") {
    await updateJobCounters(supabase, job.id, { current_step: "inserting" } as Partial<ScheduleJobRow>);
    items = await processInsertChunk(supabase, ownerId, job, items);
    job = await refreshJobStatusFromItems(supabase, job, items);
  }

  if (job.status === "completed" || job.status === "partial_failed") {
    try {
      await reportClientOperationalError(supabase, ownerId, {
        errorType: job.status === "partial_failed" ? "schedule_job_partial" : "schedule_job_completed",
        title:
          job.status === "partial_failed"
            ? "Agendamento parcialmente concluído"
            : "Agendamento concluído",
        message: `${job.completed_items}/${job.total_items} vídeos agendados.`,
        probableCause: "Processamento em chunks finalizado.",
        recommendedAction:
          job.failed_items > 0 ? "Retome para tentar apenas os itens com erro." : "Abra o calendário.",
        uploadBatchId: job.upload_batch_id ?? undefined,
        metadata: { jobId: job.id, failed: job.failed_items },
      });
    } catch {
      // ignore
    }
  }

  return buildJobStatus(job, items);
}

export async function resumeScheduleJob(
  supabase: SupabaseClient,
  ownerId: string,
  jobId: string,
) {
  const loaded = await getScheduleJob(supabase, ownerId, jobId);
  if (!loaded) throw new Error("Job não encontrado");

  const retryItems = loaded.items.filter(
    (item) => item.status === "failed" || item.status === "retrying",
  );

  for (const item of retryItems) {
    await updateJobItem(supabase, item.id, {
      status: item.destinations?.length ? "processing" : "queued",
      error_message: null,
    });
  }

  await updateJobCounters(supabase, jobId, {
    status: "processing",
    error_message: null,
  } as Partial<ScheduleJobRow>);

  return advanceScheduleJob(supabase, ownerId, jobId);
}
