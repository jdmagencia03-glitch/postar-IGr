import type { SupabaseClient } from "@supabase/supabase-js";
import { advanceScheduleJob } from "@/lib/schedule-jobs/processor";

export async function processActiveScheduleJobs(
  supabase: SupabaseClient,
  options?: { maxJobs?: number; advancesPerJob?: number },
) {
  const maxJobs = options?.maxJobs ?? 3;
  const advancesPerJob = options?.advancesPerJob ?? 2;

  const { data: jobs, error } = await supabase
    .from("schedule_jobs")
    .select("id, owner_id")
    .in("status", ["queued", "processing"])
    .order("updated_at", { ascending: true })
    .limit(maxJobs);

  if (error) throw new Error(error.message);

  const results: Array<{
    jobId: string;
    ownerId: string;
    advances: number;
    status?: string;
    error?: string;
  }> = [];

  for (const job of jobs ?? []) {
    const entry: {
      jobId: string;
      ownerId: string;
      advances: number;
      status?: string;
      error?: string;
    } = {
      jobId: job.id as string,
      ownerId: job.owner_id as string,
      advances: 0,
    };

    try {
      for (let i = 0; i < advancesPerJob; i++) {
        const status = await advanceScheduleJob(supabase, entry.ownerId, entry.jobId);
        entry.advances += 1;
        if (!status.isActive || status.status === "completed" || status.status === "partial_failed") {
          entry.status = status.status;
          break;
        }
      }
    } catch (err) {
      entry.error = err instanceof Error ? err.message : "Falha ao avançar job";
    }

    results.push(entry);
  }

  return results;
}
