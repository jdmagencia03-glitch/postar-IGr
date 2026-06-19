-- Fila resiliente de upload: leases, progresso e estados estendidos
-- Execute no SQL Editor do Supabase (após upload-file-retrying.sql)

alter table upload_files drop constraint if exists upload_files_status_check;

alter table upload_files
  add constraint upload_files_status_check
  check (status in ('pending', 'uploading', 'retrying', 'stalled', 'completed', 'failed'));

alter table upload_files add column if not exists worker_id text;
alter table upload_files add column if not exists lease_until timestamptz;
alter table upload_files add column if not exists last_progress_at timestamptz;
alter table upload_files add column if not exists completed_at timestamptz;
alter table upload_files add column if not exists failed_at timestamptz;

create index if not exists idx_upload_files_batch_lease
  on upload_files(batch_id, lease_until)
  where status in ('uploading', 'retrying');

create index if not exists idx_upload_files_batch_progress
  on upload_files(batch_id, last_progress_at desc);

alter table upload_batches add column if not exists last_progress_at timestamptz;
alter table upload_batches add column if not exists stall_detected_at timestamptz;
