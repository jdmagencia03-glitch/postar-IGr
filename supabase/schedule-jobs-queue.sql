-- Fila profissional de agendamento em lote (execute no Supabase SQL Editor)

-- Campos extras no job
alter table schedule_jobs add column if not exists worker_id text;
alter table schedule_jobs add column if not exists attempt_count int not null default 0;
alter table schedule_jobs add column if not exists queue_version int not null default 1;

-- Fila de tasks por fase/chunk
create table if not exists schedule_job_tasks (
  id uuid primary key default gen_random_uuid(),
  schedule_job_id uuid not null references schedule_jobs(id) on delete cascade,
  owner_id text not null,
  account_key text not null,
  phase text not null check (phase in ('captions', 'calendar', 'save_posts')),
  chunk_index int not null default 0,
  item_ids uuid[] not null default '{}',
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'completed', 'failed', 'cancelled')),
  attempt_count int not null default 0,
  max_attempts int not null default 5,
  next_retry_at timestamptz,
  locked_by text,
  lock_until timestamptz,
  last_heartbeat_at timestamptz,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (schedule_job_id, phase, chunk_index)
);

create index if not exists idx_schedule_jobs_owner_status
  on schedule_jobs (owner_id, status);

create index if not exists idx_schedule_jobs_account_status
  on schedule_jobs (account_id, status)
  where account_id is not null;

create index if not exists idx_schedule_jobs_status_updated
  on schedule_jobs (status, updated_at desc);

create index if not exists idx_schedule_jobs_lock_until
  on schedule_jobs (lock_until)
  where status in ('queued', 'processing');

create index if not exists idx_schedule_job_items_job_status
  on schedule_job_items (schedule_job_id, status);

create index if not exists idx_schedule_job_items_upload_file
  on schedule_job_items (upload_file_id)
  where upload_file_id is not null;

create index if not exists idx_schedule_job_tasks_pending
  on schedule_job_tasks (status, next_retry_at, created_at)
  where status in ('pending', 'processing');

create index if not exists idx_schedule_job_tasks_job
  on schedule_job_tasks (schedule_job_id, phase, status);

create index if not exists idx_schedule_job_tasks_account
  on schedule_job_tasks (account_key, phase, status)
  where status in ('pending', 'processing');

-- Idempotência: evita duplicar post do mesmo arquivo no mesmo job/conta
create unique index if not exists idx_schedule_job_items_idempotent
  on schedule_job_items (schedule_job_id, upload_file_id)
  where upload_file_id is not null;

notify pgrst, 'reload schema';
