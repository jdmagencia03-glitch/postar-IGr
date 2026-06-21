-- Lock/heartbeat para worker de agendamento em background
-- Execute no Supabase SQL Editor

alter table schedule_jobs add column if not exists locked_by text;
alter table schedule_jobs add column if not exists lock_until timestamptz;
alter table schedule_jobs add column if not exists last_heartbeat_at timestamptz;

create index if not exists idx_schedule_jobs_worker
  on schedule_jobs (status, lock_until)
  where status in ('queued', 'processing');
