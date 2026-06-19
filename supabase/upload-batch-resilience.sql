-- Correção estrutural do Upload em Lote (execute uma vez no Supabase SQL Editor)
-- Inclui: retrying, fila com leases, modo adaptativo, progresso de lote

-- 1) Estados de arquivo (retrying + stalled)
alter table upload_files drop constraint if exists upload_files_status_check;

alter table upload_files
  add constraint upload_files_status_check
  check (status in ('pending', 'uploading', 'retrying', 'stalled', 'completed', 'failed'));

-- 2) Fila resiliente — leases e progresso por arquivo
alter table upload_files add column if not exists worker_id text;
alter table upload_files add column if not exists lease_until timestamptz;
alter table upload_files add column if not exists last_progress_at timestamptz;
alter table upload_files add column if not exists completed_at timestamptz;
alter table upload_files add column if not exists failed_at timestamptz;

create index if not exists idx_upload_files_batch_lease
  on upload_files(batch_id, lease_until)
  where status in ('uploading', 'retrying', 'stalled');

create index if not exists idx_upload_files_batch_progress
  on upload_files(batch_id, last_progress_at desc);

-- 3) Watchdog de lote
alter table upload_batches add column if not exists last_progress_at timestamptz;
alter table upload_batches add column if not exists stall_detected_at timestamptz;

-- 4) Upload adaptativo (modo padrão recomendado para lotes grandes)
alter table upload_batches drop constraint if exists upload_batches_upload_speed_mode_check;

alter table upload_batches
  add constraint upload_batches_upload_speed_mode_check
  check (upload_speed_mode in ('economy', 'normal', 'turbo', 'adaptive'));

alter table upload_batches alter column upload_speed_mode set default 'adaptive';
