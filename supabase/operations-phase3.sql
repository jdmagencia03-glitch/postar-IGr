-- Fase 3 — Operação e Controle
-- Execute no SQL Editor do Supabase

alter table instagram_accounts
  add column if not exists publishing_paused boolean not null default false;

alter table tiktok_accounts
  add column if not exists publishing_paused boolean not null default false;

alter table scheduled_posts
  add column if not exists next_retry_at timestamptz;

create index if not exists idx_scheduled_posts_retrying
  on scheduled_posts (next_retry_at)
  where status in ('retrying', 'failed');
