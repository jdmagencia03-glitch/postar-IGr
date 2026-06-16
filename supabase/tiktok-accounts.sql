-- Contas TikTok conectadas via OAuth
-- Execute no SQL Editor do Supabase

create table if not exists tiktok_accounts (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null,
  open_id text not null unique,
  username text,
  display_name text,
  profile_picture_url text,
  access_token text not null,
  refresh_token text not null,
  token_expires_at timestamptz,
  refresh_expires_at timestamptz,
  scopes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_tiktok_accounts_owner_id on tiktok_accounts(owner_id);

alter table tiktok_accounts enable row level security;
