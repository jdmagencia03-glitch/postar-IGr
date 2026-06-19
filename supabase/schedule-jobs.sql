-- Agendamento resiliente por chunks (execute no Supabase SQL Editor)

create table if not exists schedule_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null,
  account_id uuid,
  tiktok_account_id uuid,
  upload_batch_id uuid references upload_batches(id) on delete set null,
  mode text not null default 'multiplatform'
    check (mode in ('autopilot', 'multiplatform')),
  platform text not null default 'instagram'
    check (platform in ('instagram', 'tiktok', 'both')),
  content_type text not null default 'reel',
  schedule_mode text not null default 'auto',
  total_items int not null default 0,
  processed_items int not null default 0,
  completed_items int not null default 0,
  failed_items int not null default 0,
  status text not null default 'queued'
    check (status in ('queued', 'processing', 'completed', 'partial_failed', 'failed', 'cancelled')),
  current_step text not null default 'queued'
    check (current_step in ('queued', 'planning', 'captions', 'inserting', 'completed')),
  config jsonb not null default '{}'::jsonb,
  error_message text,
  schedule_summary text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists schedule_job_items (
  id uuid primary key default gen_random_uuid(),
  schedule_job_id uuid not null references schedule_jobs(id) on delete cascade,
  upload_file_id uuid references upload_files(id) on delete set null,
  sort_order int not null default 0,
  filename text not null,
  media_urls jsonb not null default '[]'::jsonb,
  status text not null default 'queued'
    check (status in ('queued', 'processing', 'completed', 'failed', 'retrying')),
  scheduled_at timestamptz,
  destinations jsonb,
  caption text,
  hashtags text,
  created_post_id uuid,
  parent_publish_group_id uuid,
  error_message text,
  attempt_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (schedule_job_id, upload_file_id)
);

create index if not exists idx_schedule_jobs_owner on schedule_jobs(owner_id, created_at desc);
create index if not exists idx_schedule_jobs_batch on schedule_jobs(upload_batch_id);
create index if not exists idx_schedule_jobs_active on schedule_jobs(upload_batch_id, status)
  where status in ('queued', 'processing');
create index if not exists idx_schedule_job_items_job on schedule_job_items(schedule_job_id, sort_order);
create index if not exists idx_schedule_job_items_pending on schedule_job_items(schedule_job_id, status)
  where status in ('queued', 'processing', 'retrying');
