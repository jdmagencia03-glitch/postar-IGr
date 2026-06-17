-- Limpeza automática de mídia publicada no storage
-- Execute no SQL Editor do Supabase

alter table scheduled_posts
  add column if not exists media_cleaned_at timestamptz;

create index if not exists idx_scheduled_posts_media_cleanup
  on scheduled_posts(published_at)
  where status = 'published' and media_cleaned_at is null;
