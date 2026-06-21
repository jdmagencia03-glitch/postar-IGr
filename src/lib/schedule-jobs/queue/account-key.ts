import type { ScheduleJobConfig, ScheduleJobRow } from "@/lib/schedule-jobs/types";

export function resolveJobAccountKey(job: ScheduleJobRow): string {
  const config = job.config as ScheduleJobConfig;
  const target = config.targets?.[0];
  if (target) return `${target.platform}:${target.account_id}`;
  if (job.account_id) return `instagram:${job.account_id}`;
  if (job.tiktok_account_id) return `tiktok:${job.tiktok_account_id}`;
  return `owner:${job.owner_id}`;
}
