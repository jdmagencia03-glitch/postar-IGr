-- Adiciona updated_at em scheduled_posts (usado pelo cron de publicação)
-- Execute no SQL Editor do Supabase

alter table scheduled_posts
  add column if not exists updated_at timestamptz not null default now();

create index if not exists idx_scheduled_posts_processing_updated
  on scheduled_posts(status, updated_at)
  where status = 'processing';
