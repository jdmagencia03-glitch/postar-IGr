-- =============================================================================
-- RECUPERAÇÃO DE EMERGÊNCIA — Supabase saturado (SQL Editor dá timeout)
-- =============================================================================
-- IMPORTANTE: nomes em INGLÊS. NÃO use tradução automática do editor.
-- Coluna correta: datname  (NÃO "datename")
--
-- Se TUDO der timeout, use o painel Supabase (sem SQL):
--   Settings → General → Restart project
--   Reports → Database → ver CPU / conexões
--   Settings → Compute and Disk → aumentar compute (se Free/Pro pequeno)
-- =============================================================================


-- ── 1) Diagnóstico mínimo (só 5 linhas, sem ORDER BY pesado) ─────────────────
-- Rode SOZINHO. Se falhar, vá direto para "Restart project" no painel.

select pid, state, left(query, 80) as q
from pg_stat_activity
where datname = current_database()
  and pid <> pg_backend_pid()
limit 20;


-- ── 2) Ver só queries ativas (corrigido: datname, state = 'active') ───────────

select pid, now() - query_start as duration, left(query, 120) as query_preview
from pg_stat_activity
where datname = current_database()
  and state = 'active'
  and pid <> pg_backend_pid()
limit 30;


-- ── 3) Cancelar query presa (troque o número) ─────────────────────────────────

-- select pg_cancel_backend(12345);


-- ── 4) Ver jobs pg_cron (podem estar martelando o banco a cada 2 min) ────────

select jobid, jobname, schedule, active
from cron.job
where active = true
limit 20;


-- ── 5) Pausar cron interno do PostarIGr (se existir) ─────────────────────────

-- select cron.unschedule(jobid) from cron.job where jobname = 'postarigr-schedule-jobs';


-- ── 6) Depois que o banco responder — UM índice por vez ──────────────────────

-- create index concurrently if not exists idx_upload_batches_owner_id on upload_batches (owner_id);
