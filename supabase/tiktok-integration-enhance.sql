-- TikTok — campos operacionais e rastreamento de publicação
-- Execute no SQL Editor do Supabase

alter table tiktok_accounts
  add column if not exists last_validated_at timestamptz;

alter table tiktok_accounts
  add column if not exists last_validation_error text;

alter table tiktok_accounts
  add column if not exists status text not null default 'active'
    check (status in ('active', 'error', 'disconnected'));

alter table tiktok_accounts
  add column if not exists creator_max_duration_sec integer;

alter table tiktok_accounts
  add column if not exists creator_username text;

alter table scheduled_posts
  add column if not exists provider_publish_id text;

alter table scheduled_posts
  add column if not exists provider_status text;

alter table scheduled_posts
  add column if not exists provider_response jsonb;

create index if not exists idx_scheduled_posts_provider_publish
  on scheduled_posts (provider_publish_id)
  where provider_publish_id is not null;
