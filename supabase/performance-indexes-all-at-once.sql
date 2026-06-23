-- =============================================================================
-- POSTARIGR — ÍNDICES + ANALYZE (rodar tudo de uma vez)
-- =============================================================================
-- Pré-requisito: compute Small (2 GB RAM) já aplicado.
-- Cole no SQL Editor e clique Run UMA vez.
--
-- Se der timeout: use performance-indexes-step-by-step.sql (um bloco por vez).
-- NÃO traduza nomes de tabelas/colunas no editor.
-- =============================================================================

set statement_timeout = '15min';
set lock_timeout = '5min';

-- upload_batches (rápido)
create index if not exists idx_upload_batches_owner_id
  on upload_batches (owner_id);

-- scheduled_posts
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

-- estatísticas do planner
analyze upload_batches;
analyze instagram_accounts;
analyze app_sessions;
analyze scheduled_posts;

-- confirmar
select indexname, tablename
from pg_indexes
where schemaname = 'public'
  and (
    indexname like 'idx_scheduled_posts%'
    or indexname = 'idx_upload_batches_owner_id'
  )
order by tablename, indexname;

reset statement_timeout;
reset lock_timeout;
