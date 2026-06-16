-- Sistema supremo de upload — campos extras
-- Execute no SQL Editor do Supabase

alter table upload_batches
  add column if not exists paused boolean not null default false,
  add column if not exists upload_speed_mode text not null default 'normal'
    check (upload_speed_mode in ('economy', 'normal', 'turbo')),
  add column if not exists started_at timestamptz,
  add column if not exists finished_at timestamptz,
  add column if not exists auto_schedule_enabled boolean not null default false;

alter table upload_files
  add column if not exists file_hash text,
  add column if not exists last_modified bigint,
  add column if not exists retry_count int not null default 0,
  add column if not exists duration_seconds int,
  add column if not exists removed boolean not null default false;

create index if not exists idx_upload_files_batch_hash
  on upload_files(batch_id, file_hash);
