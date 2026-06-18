-- Fase 4 — Produtos, Ofertas e Campanhas
-- Execute no SQL Editor do Supabase (após content-types-stories.sql)

create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null,
  name text not null,
  niche text,
  description text,
  price numeric(12, 2),
  checkout_url text,
  sales_page_url text,
  whatsapp_url text,
  bio_url text,
  main_cta text,
  comment_keyword text,
  dm_message text,
  coupon text,
  status text not null default 'active' check (status in ('active', 'paused')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_products_owner on products (owner_id, status);

create table if not exists campaigns (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null,
  product_id uuid references products(id) on delete set null,
  name text not null,
  niche text,
  objective text not null default 'sell_product',
  default_cta text,
  comment_keyword text,
  dm_message text,
  main_link text,
  posts_per_day integer not null default 0,
  stories_per_day integer not null default 0,
  starts_at timestamptz,
  ends_at timestamptz,
  status text not null default 'active' check (status in ('active', 'paused', 'finished')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_campaigns_owner on campaigns (owner_id, status);

create table if not exists campaign_accounts (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  account_id uuid not null,
  platform text not null check (platform in ('instagram', 'tiktok')),
  content_types text[] not null default '{}',
  created_at timestamptz not null default now(),
  unique (campaign_id, account_id, platform)
);

create index if not exists idx_campaign_accounts_campaign on campaign_accounts (campaign_id);

-- FKs em scheduled_posts (colunas podem já existir via content-types-stories.sql)
alter table scheduled_posts
  add column if not exists product_id uuid references products(id) on delete set null;

alter table scheduled_posts
  add column if not exists campaign_id uuid references campaigns(id) on delete set null;

alter table scheduled_posts
  add column if not exists content_objective text;

create index if not exists idx_scheduled_posts_product on scheduled_posts (product_id) where product_id is not null;
create index if not exists idx_scheduled_posts_campaign on scheduled_posts (campaign_id) where campaign_id is not null;
