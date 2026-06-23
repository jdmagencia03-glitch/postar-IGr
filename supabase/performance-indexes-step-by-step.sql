-- =============================================================================
-- ÍNDICES DE PERFORMANCE — RODE UM BLOCO POR VEZ NO SQL EDITOR
-- =============================================================================
-- NÃO cole o arquivo inteiro. O Supabase encerra a conexão se demorar demais.
-- Use os nomes em INGLÊS (scheduled_posts, account_id) — não traduza colunas.
--
-- Ordem:
--   A → ver queries presas
--   B → cancelar queries lentas (se houver)
--   C → índices leves (upload_batches)
--   D → índices em scheduled_posts (um por execução, CONCURRENTLY)
--   E → ANALYZE (um por execução, por último)
-- =============================================================================


-- ── A1) Ver o que está rodando agora ─────────────────────────────────────────
-- Rode só isto. Se aparecer query com duration > 2 min, vá para B1.

select
  pid,
  state,
  wait_event_type,
  now() - query_start as duration,
  left(query, 180) as query_preview
from pg_stat_activity
where datname = current_database()
  and pid <> pg_backend_pid()
  and state = 'active'
order by query_start;


-- ── B1) Cancelar query presa (troque 12345 pelo pid de A1) ───────────────────
-- Descomente e rode UMA linha por vez:

-- select pg_cancel_backend(12345);

-- Se cancel não resolver em 30s:
-- select pg_terminate_backend(12345);


-- ── C1) Índice leve — upload_batches (rápido, rode primeiro) ─────────────────

create index concurrently if not exists idx_upload_batches_owner_id
  on upload_batches (owner_id);


-- ── D1) scheduled_posts — upload_batch_id ────────────────────────────────────
-- Pode levar 1–5 min em tabela grande. Aguarde "Success" antes do próximo.

create index concurrently if not exists idx_scheduled_posts_upload_batch_id
  on scheduled_posts (upload_batch_id)
  where upload_batch_id is not null;


-- ── D2) scheduled_posts — Instagram (account_id + status + scheduled_at) ───

create index concurrently if not exists idx_scheduled_posts_ig_status_scheduled
  on scheduled_posts (account_id, status, scheduled_at)
  where status <> 'cancelled';


-- ── D3) scheduled_posts — TikTok ─────────────────────────────────────────────

create index concurrently if not exists idx_scheduled_posts_tt_status_scheduled
  on scheduled_posts (tiktok_account_id, status, scheduled_at)
  where tiktok_account_id is not null and status <> 'cancelled';


-- ── D4) scheduled_posts — última publicação ──────────────────────────────────

create index concurrently if not exists idx_scheduled_posts_published_at
  on scheduled_posts (published_at desc)
  where status = 'published' and published_at is not null;


-- ── E1) Atualizar estatísticas — um por execução ─────────────────────────────

analyze upload_batches;

-- analyze instagram_accounts;

-- analyze app_sessions;

-- analyze scheduled_posts;  -- o mais pesado; rode por último, fora do horário de pico


-- ── F1) Confirmar índices criados ────────────────────────────────────────────

select indexname, tablename
from pg_indexes
where schemaname = 'public'
  and indexname like 'idx_scheduled_posts%'
   or indexname = 'idx_upload_batches_owner_id'
order by tablename, indexname;
