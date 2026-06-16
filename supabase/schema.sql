-- Execute no SQL Editor do Supabase (gratuito)
-- https://supabase.com/dashboard

create extension if not exists "pgcrypto";

create table if not exists oauth_states (
  state text primary key,
  next_path text,
  created_at timestamptz not null default now()
);

create index if not exists idx_oauth_states_created_at on oauth_states(created_at);

create table if not exists app_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id text not null unique,
  session_token text unique,
  access_token text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_app_sessions_session_token on app_sessions(session_token);

create table if not exists instagram_accounts (
  id uuid primary key default gen_random_uuid(),
  owner_id text,
  user_id text not null,
  ig_user_id text not null unique,
  ig_username text,
  page_id text not null,
  page_access_token text not null,
  profile_picture_url text,
  auth_provider text not null default 'instagram',
  warmup_enabled boolean not null default true,
  warmup_days int not null default 5,
  warmup_started_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_instagram_accounts_user_id on instagram_accounts(user_id);
create index if not exists idx_instagram_accounts_owner_id on instagram_accounts(owner_id);

create table if not exists scheduled_posts (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references instagram_accounts(id) on delete cascade,
  media_type text not null check (media_type in ('IMAGE', 'REELS', 'CAROUSEL')),
  media_urls text[] not null,
  caption text,
  scheduled_at timestamptz not null,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'published', 'failed')),
  container_id text,
  media_id text,
  permalink text,
  error_message text,
  published_at timestamptz,
  hidden_from_report boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_scheduled_posts_status_time
  on scheduled_posts(status, scheduled_at);

create index if not exists idx_scheduled_posts_account
  on scheduled_posts(account_id);

create table if not exists publish_logs (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references scheduled_posts(id) on delete cascade,
  level text not null check (level in ('info', 'error', 'success')),
  message text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_publish_logs_post_id on publish_logs(post_id);

create table if not exists account_metrics_snapshots (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references instagram_accounts(id) on delete cascade,
  followers_count int not null,
  recorded_at timestamptz not null default now()
);

create index if not exists idx_account_metrics_account_time
  on account_metrics_snapshots(account_id, recorded_at desc);

create table if not exists ai_playbooks (
  owner_id text primary key,
  brand_name text,
  niche text,
  target_audience text,
  tone_voice text,
  viral_hooks text,
  hashtag_strategy text,
  cta_style text,
  example_captions text,
  avoid_rules text,
  extra_knowledge text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Bucket de mídia (vídeos/imagens para o Instagram baixar via URL pública)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'media',
  'media',
  true,
  524288000,
  array['video/mp4', 'video/quicktime', 'video/webm', 'image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = true,
  file_size_limit = 524288000;

-- Leitura pública (Instagram precisa acessar a URL)
create policy "Public read media"
on storage.objects for select
using (bucket_id = 'media');

-- Upload via service role (API do app) — service role ignora RLS,
-- mas a policy abaixo permite upload autenticado se necessário no futuro
create policy "Service upload media"
on storage.objects for insert
with check (bucket_id = 'media');
