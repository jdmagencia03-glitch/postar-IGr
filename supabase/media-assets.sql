-- Integridade de mídia: assets confiáveis + referências em posts
-- Execute no SQL Editor do Supabase

create table if not exists media_assets (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null,
  upload_file_id uuid references upload_files(id) on delete set null,
  bucket text not null default 'media',
  storage_path text not null,
  public_url text not null,
  mime_type text,
  size_bytes bigint,
  file_hash text,
  status text not null default 'uploading'
    check (status in (
      'uploading',
      'uploaded',
      'validated',
      'attached',
      'missing',
      'deleted',
      'safe_to_delete'
    )),
  validation_status text not null default 'pending'
    check (validation_status in ('pending', 'valid', 'invalid')),
  last_validation_at timestamptz,
  last_validation_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, storage_path)
);

create index if not exists idx_media_assets_owner on media_assets(owner_id, status);
create index if not exists idx_media_assets_public_url on media_assets(public_url);
create index if not exists idx_media_assets_upload_file on media_assets(upload_file_id);

alter table upload_files add column if not exists media_asset_id uuid references media_assets(id) on delete set null;

alter table scheduled_posts add column if not exists media_asset_id uuid references media_assets(id) on delete set null;
alter table scheduled_posts add column if not exists cancel_reason text;

alter table instagram_accounts add column if not exists pause_reason text;

-- needs_media: vídeo ausente/inválido — não consome retry de publicação
alter table scheduled_posts drop constraint if exists scheduled_posts_status_check;
alter table scheduled_posts
  add constraint scheduled_posts_status_check
  check (status in (
    'pending',
    'processing',
    'published',
    'failed',
    'retrying',
    'failed_persistent',
    'cancelled',
    'needs_media'
  ));
