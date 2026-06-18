-- Sprint 1A: content_type, Stories e base multiplataforma
-- Execute no SQL Editor do Supabase

alter table scheduled_posts
  add column if not exists content_type text
    check (content_type in ('reel', 'post', 'story', 'tiktok_video', 'youtube_short')),
  add column if not exists title text,
  add column if not exists description text,
  add column if not exists hashtags text,
  add column if not exists story_cta text,
  add column if not exists story_link text,
  add column if not exists story_objective text,
  add column if not exists content_objective text,
  add column if not exists campaign_id uuid,
  add column if not exists product_id uuid,
  add column if not exists upload_batch_id uuid,
  add column if not exists parent_publish_group_id uuid,
  add column if not exists retry_count int not null default 0,
  add column if not exists is_draft boolean not null default false,
  add column if not exists publish_block_reason text,
  add column if not exists youtube_account_id uuid;

-- Backfill: posts existentes viram reel/post sem alterar horários ou legendas
update scheduled_posts
set content_type = case
  when media_type = 'IMAGE' then 'post'
  when media_type = 'CAROUSEL' then 'post'
  else 'reel'
end
where content_type is null;

alter table scheduled_posts
  alter column content_type set default 'reel';

create index if not exists idx_scheduled_posts_content_type
  on scheduled_posts(content_type, status, scheduled_at);

create index if not exists idx_scheduled_posts_parent_group
  on scheduled_posts(parent_publish_group_id)
  where parent_publish_group_id is not null;
