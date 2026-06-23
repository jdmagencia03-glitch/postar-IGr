import { PIPELINE_MIGRATION_REQUIRED } from "@/lib/schedule-jobs/pipeline-schema";

export class PipelineMigrationRequiredError extends Error {
  readonly code = PIPELINE_MIGRATION_REQUIRED;

  constructor(message?: string) {
    super(
      message ??
        "pipeline_migration_required: coluna schedule_job_items.pipeline ausente — execute a migration antes de processar.",
    );
    this.name = "PipelineMigrationRequiredError";
  }
}

export function isPipelineMigrationRequiredError(
  error: unknown,
): error is PipelineMigrationRequiredError {
  return (
    error instanceof PipelineMigrationRequiredError ||
    (error instanceof Error && error.message.includes(PIPELINE_MIGRATION_REQUIRED))
  );
}
