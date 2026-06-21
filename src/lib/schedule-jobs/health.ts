import type { SupabaseClient } from "@supabase/supabase-js";
import { isJobStale, isWorkerActive } from "@/lib/schedule-jobs/state";
import type { ScheduleJobRow } from "@/lib/schedule-jobs/types";

export const WORKER_COLUMNS = ["locked_by", "lock_until", "last_heartbeat_at"] as const;

export const BASE_JOB_COLUMNS = [
  "status",
  "current_step",
  "processed_items",
  "completed_items",
  "failed_items",
] as const;

export const REQUIRED_JOB_COLUMNS = [...BASE_JOB_COLUMNS, ...WORKER_COLUMNS] as const;

export type ScheduleJobsSchemaCheck = {
  ok: boolean;
  baseColumnsReady: boolean;
  tableExists: boolean;
  missingColumns: string[];
  missingBaseColumns: string[];
  missingWorkerColumns: string[];
  workerColumnsReady: boolean;
  error?: string;
  action?: string;
};

export type CronErrorKind =
  | "missing_column"
  | "missing_table"
  | "supabase_error"
  | "env_missing"
  | "worker_failed"
  | "unknown";

export function classifyCronError(message: string): {
  error: CronErrorKind;
  action?: string;
} {
  if (/schedule_job_tasks|Could not find the table.*schedule_job_tasks/i.test(message)) {
    return { error: "missing_table", action: "run supabase/schedule-jobs-queue.sql" };
  }
  if (/relation "schedule_jobs" does not exist|schedule_jobs.*does not exist/i.test(message)) {
    return { error: "missing_table", action: "run supabase/schedule-jobs.sql" };
  }
  if (/locked_by|lock_until|last_heartbeat|column.*does not exist|schema cache/i.test(message)) {
    return { error: "missing_column", action: "run supabase/schedule-jobs-worker.sql" };
  }
  if (/Missing required environment variable|SUPABASE|supabaseUrl/i.test(message)) {
    return { error: "env_missing", action: "check Vercel Production env vars" };
  }
  return { error: "unknown" };
}

export async function checkScheduleJobsSchema(
  supabase: SupabaseClient,
): Promise<ScheduleJobsSchemaCheck> {
  const { error: tableError } = await supabase.from("schedule_jobs").select("id", { head: true, count: "exact" });

  if (tableError) {
    if (/does not exist|relation/i.test(tableError.message)) {
      return {
        ok: false,
        baseColumnsReady: false,
        tableExists: false,
        missingColumns: [...REQUIRED_JOB_COLUMNS],
        missingBaseColumns: [...BASE_JOB_COLUMNS],
        missingWorkerColumns: [...WORKER_COLUMNS],
        workerColumnsReady: false,
        error: tableError.message,
        action: "run supabase/schedule-jobs.sql",
      };
    }
    return {
      ok: false,
      baseColumnsReady: false,
      tableExists: true,
      missingColumns: [],
      missingBaseColumns: [],
      missingWorkerColumns: [],
      workerColumnsReady: false,
      error: tableError.message,
      action: "check Supabase connection and permissions",
    };
  }

  const missingColumns: string[] = [];
  const missingBaseColumns: string[] = [];
  const missingWorkerColumns: string[] = [];

  for (const column of REQUIRED_JOB_COLUMNS) {
    const { error } = await supabase.from("schedule_jobs").select(column).limit(1);
    if (error && /column|schema cache/i.test(error.message)) {
      missingColumns.push(column);
      if ((BASE_JOB_COLUMNS as readonly string[]).includes(column)) {
        missingBaseColumns.push(column);
      }
      if ((WORKER_COLUMNS as readonly string[]).includes(column)) {
        missingWorkerColumns.push(column);
      }
    }
  }

  const baseColumnsReady = missingBaseColumns.length === 0;
  const workerColumnsReady = missingWorkerColumns.length === 0;

  return {
    ok: baseColumnsReady,
    baseColumnsReady,
    tableExists: true,
    missingColumns,
    missingBaseColumns,
    missingWorkerColumns,
    workerColumnsReady,
    error: missingColumns.length ? `missing columns: ${missingColumns.join(", ")}` : undefined,
    action: !baseColumnsReady
      ? "run supabase/schedule-jobs.sql"
      : !workerColumnsReady
        ? "run supabase/schedule-jobs-worker.sql (optional but recommended)"
        : undefined,
  };
}

export type ScheduleJobsHealthSnapshot = {
  ok: boolean;
  authOk: boolean;
  cronSecretConfigured: boolean;
  supabaseConnected: boolean;
  schema: ScheduleJobsSchemaCheck;
  activeJobs: number;
  stalledJobs: number;
  lastUpdatedJob: {
    id: string;
    status: string;
    processedItems: number;
    completedItems: number;
    updatedAt: string;
    workerActive: boolean;
  } | null;
  env: {
    supabaseUrl: boolean;
    serviceRoleKey: boolean;
    cronSecret: boolean;
  };
};

export async function getScheduleJobsHealthSnapshot(
  supabase: SupabaseClient,
  options: { authOk: boolean; cronSecretConfigured: boolean },
): Promise<ScheduleJobsHealthSnapshot> {
  const env = {
    supabaseUrl: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()),
    serviceRoleKey: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()),
    cronSecret: options.cronSecretConfigured,
  };

  const schema = await checkScheduleJobsSchema(supabase);
  const supabaseConnected = schema.tableExists && !schema.error?.includes("connection");

  if (!schema.tableExists || !schema.baseColumnsReady) {
    return {
      ok: false,
      authOk: options.authOk,
      cronSecretConfigured: options.cronSecretConfigured,
      supabaseConnected,
      schema,
      activeJobs: 0,
      stalledJobs: 0,
      lastUpdatedJob: null,
      env,
    };
  }

  const selectCols = schema.workerColumnsReady
    ? "id, status, processed_items, completed_items, updated_at, locked_by, lock_until, last_heartbeat_at"
    : "id, status, processed_items, completed_items, updated_at";

  const { data: activeRows, error: activeError } = await supabase
    .from("schedule_jobs")
    .select(selectCols)
    .in("status", ["queued", "processing"])
    .order("updated_at", { ascending: false })
    .limit(50);

  if (activeError) {
    return {
      ok: false,
      authOk: options.authOk,
      cronSecretConfigured: options.cronSecretConfigured,
      supabaseConnected: false,
      schema: {
        ...schema,
        ok: false,
        error: activeError.message,
        action: classifyCronError(activeError.message).action,
      },
      activeJobs: 0,
      stalledJobs: 0,
      lastUpdatedJob: null,
      env,
    };
  }

  const jobs = (activeRows ?? []) as unknown as ScheduleJobRow[];
  let stalledJobs = 0;
  for (const job of jobs) {
    if (isJobStale(job) && !isWorkerActive(job)) stalledJobs += 1;
  }

  const latest = jobs[0] ?? null;

  return {
    ok: schema.baseColumnsReady && supabaseConnected,
    authOk: options.authOk,
    cronSecretConfigured: options.cronSecretConfigured,
    supabaseConnected,
    schema,
    activeJobs: jobs.length,
    stalledJobs,
    lastUpdatedJob: latest
      ? {
          id: latest.id,
          status: latest.status,
          processedItems: latest.processed_items,
          completedItems: latest.completed_items,
          updatedAt: latest.updated_at,
          workerActive: isWorkerActive(latest),
        }
      : null,
    env,
  };
}

export function cronErrorResponse(
  message: string,
  extra?: { processed?: number; jobs?: unknown[] },
) {
  const { error, action } = classifyCronError(message);
  return {
    ok: false as const,
    error,
    message,
    action,
    processed: extra?.processed ?? 0,
    jobs: extra?.jobs ?? [],
  };
}
