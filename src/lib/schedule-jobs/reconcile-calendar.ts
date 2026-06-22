import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  ScheduleJobDestination,
  ScheduleJobItemRow,
  ScheduleJobRow,
} from "@/lib/schedule-jobs/types";

type CalendarPost = {
  id: string;
  media_urls: string[] | null;
  parent_publish_group_id?: string | null;
};

export type ReconcileCalendarResult = {
  job: ScheduleJobRow;
  reconciled: boolean;
  error: string | null;
};

const ITEM_UPDATE_CHUNK = 10;

function logReconcile(stage: string, jobId: string, extra?: Record<string, unknown>) {
  console.info(`[reconcile-${stage}]`, { jobId, ...extra });
}

function parseDestinations(raw: unknown): ScheduleJobDestination[] | null {
  if (Array.isArray(raw)) return raw as ScheduleJobDestination[];
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? (parsed as ScheduleJobDestination[]) : null;
    } catch {
      return null;
    }
  }
  return null;
}

function mapItem(row: Record<string, unknown>): ScheduleJobItemRow {
  return {
    ...(row as ScheduleJobItemRow),
    media_urls: Array.isArray(row.media_urls) ? (row.media_urls as string[]) : [],
    destinations: parseDestinations(row.destinations),
  };
}

function buildPostIndexes(posts: CalendarPost[]) {
  const postIdsInBatch = new Set<string>();
  const postIdByMediaUrl = new Map<string, string>();
  const postIdByGroup = new Map<string, string>();

  for (const post of posts) {
    postIdsInBatch.add(post.id);

    const urls = post.media_urls ?? [];
    for (const url of urls) {
      if (url && !postIdByMediaUrl.has(url)) {
        postIdByMediaUrl.set(url, post.id);
      }
    }

    if (post.parent_publish_group_id && !postIdByGroup.has(post.parent_publish_group_id)) {
      postIdByGroup.set(post.parent_publish_group_id, post.id);
    }
  }

  return { postIdsInBatch, postIdByMediaUrl, postIdByGroup };
}

function resolvePostIdForItem(
  item: ScheduleJobItemRow,
  indexes: ReturnType<typeof buildPostIndexes>,
): string | null {
  const { postIdsInBatch, postIdByMediaUrl, postIdByGroup } = indexes;

  if (item.created_post_id && postIdsInBatch.has(item.created_post_id)) {
    return item.created_post_id;
  }

  for (const dest of item.destinations ?? []) {
    if (dest.created_post_id && postIdsInBatch.has(dest.created_post_id)) {
      return dest.created_post_id;
    }
  }

  if (item.parent_publish_group_id) {
    const byGroup = postIdByGroup.get(item.parent_publish_group_id);
    if (byGroup) return byGroup;
  }

  const url = item.media_urls?.[0];
  if (url) {
    const byUrl = postIdByMediaUrl.get(url);
    if (byUrl) return byUrl;
  }

  return null;
}

async function syncJobCounters(supabase: SupabaseClient, jobId: string) {
  const base = () =>
    supabase.from("schedule_job_items").select("id", { count: "exact", head: true }).eq("schedule_job_id", jobId);

  const [totalRes, completedRes, failedRes, processedRes] = await Promise.all([
    base(),
    base().eq("status", "completed").not("created_post_id", "is", null),
    base().eq("status", "failed"),
    base().not("destinations", "is", null),
  ]);

  if (totalRes.error) throw new Error(totalRes.error.message);
  if (completedRes.error) throw new Error(completedRes.error.message);
  if (failedRes.error) throw new Error(failedRes.error.message);
  if (processedRes.error) throw new Error(processedRes.error.message);

  return {
    total: totalRes.count ?? 0,
    completed: completedRes.count ?? 0,
    failed: failedRes.count ?? 0,
    processed: processedRes.count ?? 0,
  };
}

async function updateItemsInChunks(
  supabase: SupabaseClient,
  jobId: string,
  repairs: Array<{ item: ScheduleJobItemRow; postId: string }>,
) {
  const now = new Date().toISOString();
  let repairedItems = 0;

  for (let offset = 0; offset < repairs.length; offset += ITEM_UPDATE_CHUNK) {
    const chunk = repairs.slice(offset, offset + ITEM_UPDATE_CHUNK);
    await Promise.all(
      chunk.map(async ({ item, postId }) => {
        const destinations = (item.destinations ?? []).map((dest) => ({
          ...dest,
          created_post_id: dest.created_post_id ?? postId,
        }));

        const { error } = await supabase
          .from("schedule_job_items")
          .update({
            status: "completed",
            created_post_id: postId,
            destinations,
            error_message: null,
            updated_at: now,
          })
          .eq("id", item.id);

        if (error) throw new Error(error.message);
        repairedItems += 1;
      }),
    );
  }

  return repairedItems;
}

/**
 * Reconcilia job/itens/tasks com posts já existentes no calendário.
 * Idempotente: não insere posts, não duplica — apenas atualiza status/metadata.
 */
export async function reconcileJobFromCalendarPosts(
  supabase: SupabaseClient,
  job: ScheduleJobRow,
): Promise<ScheduleJobRow | null> {
  logReconcile("start", job.id, { batchId: job.upload_batch_id, status: job.status });

  if (!job.upload_batch_id || job.total_items <= 0) return null;
  if (job.status === "cancelled") return null;
  if (job.status === "completed" && job.completed_items >= job.total_items) return null;

  logReconcile("load-items", job.id);
  const { data: items, error: itemsError } = await supabase
    .from("schedule_job_items")
    .select("id, status, media_urls, destinations, created_post_id, parent_publish_group_id, upload_file_id")
    .eq("schedule_job_id", job.id);
  if (itemsError) throw new Error(itemsError.message);

  const mappedItems = (items ?? []).map((row) => mapItem(row as Record<string, unknown>));
  if (!mappedItems.length) return null;

  logReconcile("load-posts", job.id, { batchId: job.upload_batch_id });
  const { data: posts, error: postsError } = await supabase
    .from("scheduled_posts")
    .select("id, media_urls, parent_publish_group_id, upload_batch_id, status, scheduled_at")
    .eq("upload_batch_id", job.upload_batch_id);
  if (postsError) throw new Error(postsError.message);

  const calendarPosts: CalendarPost[] = (posts ?? []).map((post) => ({
    id: post.id as string,
    media_urls: Array.isArray(post.media_urls) ? (post.media_urls as string[]) : [],
    parent_publish_group_id: (post.parent_publish_group_id as string | null) ?? null,
  }));

  const indexes = buildPostIndexes(calendarPosts);
  const itemMatches = mappedItems.map((item) => ({
    item,
    postId: resolvePostIdForItem(item, indexes),
  }));
  const matched = itemMatches.filter((row) => row.postId).length;

  logReconcile("match-items", job.id, { matched, total: job.total_items, posts: calendarPosts.length });
  if (matched < job.total_items) return null;

  const repairs = itemMatches.filter(
    (row): row is { item: ScheduleJobItemRow; postId: string } =>
      Boolean(row.postId) &&
      !(row.item.status === "completed" && row.item.created_post_id === row.postId),
  );

  logReconcile("update-items", job.id, { repairs: repairs.length });
  const repairedItems = repairs.length
    ? await updateItemsInChunks(supabase, job.id, repairs)
    : 0;

  const now = new Date().toISOString();
  logReconcile("update-tasks", job.id);
  const { error: tasksError } = await supabase
    .from("schedule_job_tasks")
    .update({
      status: "completed",
      completed_at: now,
      locked_by: null,
      lock_until: null,
      updated_at: now,
    })
    .eq("schedule_job_id", job.id)
    .eq("phase", "save_posts")
    .neq("status", "cancelled");

  if (tasksError) throw new Error(tasksError.message);

  logReconcile("update-job", job.id);
  const counts = await syncJobCounters(supabase, job.id);
  const status = counts.failed > 0 ? "partial_failed" : "completed";

  const { error: jobError } = await supabase
    .from("schedule_jobs")
    .update({
      completed_items: counts.completed,
      failed_items: counts.failed,
      processed_items: counts.processed,
      status,
      current_step: "completed",
      completed_at: job.completed_at ?? now,
      error_message: null,
      updated_at: now,
    })
    .eq("id", job.id);

  if (jobError) throw new Error(jobError.message);

  logReconcile("finished", job.id, {
    batchId: job.upload_batch_id,
    repairedItems,
    matched,
    status,
    previousStatus: job.status,
  });

  return {
    ...job,
    completed_items: counts.completed,
    failed_items: counts.failed,
    processed_items: counts.processed,
    status,
    current_step: "completed",
    completed_at: job.completed_at ?? now,
    error_message: null,
    updated_at: now,
  } as ScheduleJobRow;
}

export async function safeReconcileJobFromCalendarPosts(
  supabase: SupabaseClient,
  job: ScheduleJobRow,
): Promise<ReconcileCalendarResult> {
  try {
    const reconciled = await reconcileJobFromCalendarPosts(supabase, job);
    return {
      job: reconciled ?? job,
      reconciled: Boolean(reconciled),
      error: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logReconcile("failed", job.id, { batchId: job.upload_batch_id, error: message });
    return { job, reconciled: false, error: message };
  }
}
