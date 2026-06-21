import type { SupabaseClient } from "@supabase/supabase-js";
import { isJobStale, isWorkerActive } from "@/lib/schedule-jobs/state";
import type { ScheduleJobRow } from "@/lib/schedule-jobs/types";
import { isScheduleJobQueueReady } from "@/lib/schedule-jobs/queue/schema";
import { listQueueStats } from "@/lib/schedule-jobs/queue/tasks";

export type ScheduleJobsProfessionalHealth = {
  ok: boolean;
  queueTableReady: boolean;
  queueMode: "professional" | "legacy";
  worker: "active" | "idle" | "degraded";
  dispatcher: "inngest" | "local" | "fallback";
  lastRunAt: string | null;
  queuedJobs: number;
  processingJobs: number;
  stuckJobs: number;
  failedJobs: number;
  completedJobsToday: number;
  queue: Record<string, number>;
  inngestConfigured: boolean;
  cronFallbackConfigured: boolean;
};

export async function getProfessionalScheduleJobsHealth(
  supabase: SupabaseClient,
): Promise<ScheduleJobsProfessionalHealth> {
  const queueTableReady = await isScheduleJobQueueReady(supabase);
  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);

  const [
    { count: queuedJobs },
    { count: processingJobs },
    { count: failedJobs },
    { count: completedJobsToday },
    { data: activeRows },
    queue,
  ] = await Promise.all([
    supabase
      .from("schedule_jobs")
      .select("id", { count: "exact", head: true })
      .eq("status", "queued"),
    supabase
      .from("schedule_jobs")
      .select("id", { count: "exact", head: true })
      .eq("status", "processing"),
    supabase
      .from("schedule_jobs")
      .select("id", { count: "exact", head: true })
      .eq("status", "failed"),
    supabase
      .from("schedule_jobs")
      .select("id", { count: "exact", head: true })
      .eq("status", "completed")
      .gte("completed_at", startOfDay.toISOString()),
    supabase
      .from("schedule_jobs")
      .select("*")
      .in("status", ["queued", "processing"])
      .order("updated_at", { ascending: false })
      .limit(50),
    listQueueStats(supabase).catch(() => ({
      pending: 0,
      processing: 0,
      failed: 0,
      completed: 0,
    })),
  ]);

  const jobs = (activeRows ?? []) as ScheduleJobRow[];
  let stuckJobs = 0;
  let workerActive = false;
  for (const job of jobs) {
    if (isWorkerActive(job)) workerActive = true;
    if (isJobStale(job) && !isWorkerActive(job)) stuckJobs += 1;
  }

  const inngestConfigured = Boolean(process.env.INNGEST_EVENT_KEY?.trim());
  const cronFallbackConfigured = Boolean(process.env.CRON_SECRET?.trim());

  const dispatcher = inngestConfigured ? "inngest" : cronFallbackConfigured ? "fallback" : "local";

  const worker =
    workerActive || (queue.processing ?? 0) > 0
      ? "active"
      : stuckJobs > 0
        ? "degraded"
        : "idle";

  const latest = jobs[0];

  return {
    ok: stuckJobs === 0,
    queueTableReady,
    queueMode: queueTableReady ? "professional" : "legacy",
    worker,
    dispatcher,
    lastRunAt: latest?.updated_at ?? null,
    queuedJobs: queuedJobs ?? 0,
    processingJobs: processingJobs ?? 0,
    stuckJobs,
    failedJobs: failedJobs ?? 0,
    completedJobsToday: completedJobsToday ?? 0,
    queue,
    inngestConfigured,
    cronFallbackConfigured,
  };
}
