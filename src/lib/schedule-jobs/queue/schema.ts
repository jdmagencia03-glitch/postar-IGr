import type { SupabaseClient } from "@supabase/supabase-js";

let cachedReady: boolean | null = null;
let cachedAt = 0;
const CACHE_MS = 30_000;

export function isScheduleJobQueueTableError(message: string) {
  return /Could not find the table.*schedule_job_tasks|schedule_job_tasks.*does not exist|PGRST205/i.test(
    message,
  );
}

export async function isScheduleJobQueueReady(supabase: SupabaseClient, force = false) {
  if (!force && cachedReady !== null && Date.now() - cachedAt < CACHE_MS) {
    return cachedReady;
  }

  const { error } = await supabase
    .from("schedule_job_tasks")
    .select("id", { head: true, count: "exact" });

  if (error) {
    if (isScheduleJobQueueTableError(error.message)) {
      cachedReady = false;
      cachedAt = Date.now();
      return false;
    }
    throw new Error(error.message);
  }

  cachedReady = true;
  cachedAt = Date.now();
  return true;
}

export function resetScheduleJobQueueSchemaCache() {
  cachedReady = null;
  cachedAt = 0;
}
