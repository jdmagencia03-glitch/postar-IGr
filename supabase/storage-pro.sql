-- Otimizações de storage para Supabase Pro
-- Execute no SQL Editor após ativar o plano Pro

-- 1 GB por arquivo (ajuste conforme necessidade; Pro suporta até 500 GB)
update storage.buckets
set
  file_size_limit = 1073741824,
  public = true,
  allowed_mime_types = array[
    'video/mp4',
    'video/quicktime',
    'video/webm',
    'video/x-m4v',
    'image/jpeg',
    'image/png',
    'image/webp'
  ]
where id = 'media';

-- Índice para consultas de arquivos por lote (uploads massivos)
create index if not exists idx_upload_files_batch_sort
  on upload_files(batch_id, sort_order);
