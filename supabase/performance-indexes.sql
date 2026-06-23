-- Índices para acelerar dashboard, health checks e queries por lote.
-- Rode no SQL Editor do Supabase (idempotente).

create index if not exists idx_scheduled_posts_upload_batch_id
  on scheduled_posts (upload_batch_id)
  where upload_batch_id is not null;

create index if not exists idx_scheduled_posts_ig_status_scheduled
  on scheduled_posts (account_id, status, scheduled_at)
  where status <> 'cancelled';

create index if not exists idx_scheduled_posts_tt_status_scheduled
  on scheduled_posts (tiktok_account_id, status, scheduled_at)
  where tiktok_account_id is not null and status <> 'cancelled';

create index if not exists idx_scheduled_posts_published_at
  on scheduled_posts (published_at desc)
  where status = 'published' and published_at is not null;

create index if not exists idx_upload_batches_owner_id
  on upload_batches (owner_id);

analyze scheduled_posts;
analyze upload_batches;
analyze instagram_accounts;
analyze app_sessions;
