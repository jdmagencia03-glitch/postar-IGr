-- Modo Adaptativo de upload (upload_speed_mode)
-- Execute no SQL Editor do Supabase após upload-supreme.sql

alter table upload_batches drop constraint if exists upload_batches_upload_speed_mode_check;

alter table upload_batches
  add constraint upload_batches_upload_speed_mode_check
  check (upload_speed_mode in ('economy', 'normal', 'turbo', 'adaptive'));

alter table upload_batches alter column upload_speed_mode set default 'adaptive';
