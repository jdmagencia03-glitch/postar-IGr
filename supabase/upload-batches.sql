-- Lotes de upload com retomada
-- Execute no SQL Editor do Supabase

create table if not exists upload_batches (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null,
  account_id uuid not null references instagram_accounts(id) on delete cascade,
  schedule_mode text not null default 'auto'
    check (schedule_mode in ('today', 'auto', 'warmup', 'custom')),
  custom_schedule jsonb,
  status text not null default 'uploading'
    check (status in ('uploading', 'ready', 'scheduling', 'scheduled', 'cancelled')),
  total_files int not null default 0,
  completed_files int not null default 0,
  failed_files int not null default 0,
  batch_number serial,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_upload_batches_owner_status
  on upload_batches(owner_id, status);

create table if not exists upload_files (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references upload_batches(id) on delete cascade,
  filename text not null,
  file_size bigint not null,
  content_type text not null default 'video/mp4',
  storage_path text not null,
  public_url text,
  status text not null default 'pending'
    check (status in ('pending', 'uploading', 'completed', 'failed')),
  bytes_uploaded bigint not null default 0,
  error_message text,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (batch_id, filename, file_size)
);

create index if not exists idx_upload_files_batch_status
  on upload_files(batch_id, status);
