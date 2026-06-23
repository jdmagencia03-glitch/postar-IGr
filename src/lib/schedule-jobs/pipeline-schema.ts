import type { SupabaseClient } from "@supabase/supabase-js";

export const PIPELINE_MIGRATION_REQUIRED = "pipeline_migration_required" as const;

let cachedReady: boolean | null = null;
let cachedAt = 0;
const CACHE_MS = 30_000;

export function isPipelineColumnError(message: string) {
  return /Could not find the.*pipeline.*column|column.*pipeline.*does not exist|schedule_job_items\.pipeline|PGRST204/i.test(
    message,
  );
}

export function resetPipelineColumnCache() {
  cachedReady = null;
  cachedAt = 0;
}

export async function isPipelineColumnReady(supabase: SupabaseClient, force = false) {
  if (!force && cachedReady !== null && Date.now() - cachedAt < CACHE_MS) {
    return cachedReady;
  }

  const { error } = await supabase
    .from("schedule_job_items")
    .select("pipeline")
    .limit(1);

  if (error) {
    if (isPipelineColumnError(error.message)) {
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

export function pipelineMigrationMessage() {
  return "pipeline_migration_required: execute supabase/schedule-job-items-pipeline.sql no ambiente antes de processar legendas em fila.";
}
