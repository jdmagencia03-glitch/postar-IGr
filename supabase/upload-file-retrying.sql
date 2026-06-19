-- Estados retrying para upload_files (execute no SQL Editor do Supabase)

alter table upload_files drop constraint if exists upload_files_status_check;

alter table upload_files
  add constraint upload_files_status_check
  check (status in ('pending', 'uploading', 'retrying', 'completed', 'failed'));
