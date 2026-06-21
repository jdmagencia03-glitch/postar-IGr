import type { SupabaseClient } from "@supabase/supabase-js";

/** Itens marcados completed sem post real — volta para fila de salvamento. */
export async function resetGhostCompletedJobItems(
  supabase: SupabaseClient,
  jobId: string,
): Promise<number> {
  const { data, error } = await supabase
    .from("schedule_job_items")
    .select("id")
    .eq("schedule_job_id", jobId)
    .eq("status", "completed")
    .is("created_post_id", null)
    .not("destinations", "is", null);

  if (error) throw new Error(error.message);
  if (!data?.length) return 0;

  const now = new Date().toISOString();
  const { error: updateError } = await supabase
    .from("schedule_job_items")
    .update({ status: "queued", error_message: null, updated_at: now })
    .eq("schedule_job_id", jobId)
    .eq("status", "completed")
    .is("created_post_id", null)
    .not("destinations", "is", null);

  if (updateError) throw new Error(updateError.message);

  console.info("[schedule-job-reset-ghost]", { jobId, resetCount: data.length });
  return data.length;
}
