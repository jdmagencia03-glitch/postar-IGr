-- Otimizações de storage para Supabase Pro
-- Execute no SQL Editor após ativar o plano Pro
--
-- IMPORTANTE: além deste SQL, suba o limite GLOBAL no Dashboard:
-- Storage → Settings → Global file size limit → 500 MB (524288000 bytes)
-- O global tem precedência sobre o bucket; sem isso, arquivos > 50 MB retornam 413.

-- 500 MB por arquivo no bucket (ajuste conforme necessidade; Pro suporta até 500 GB)
update storage.buckets
set
  file_size_limit = 524288000,
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
