-- Destravar Supabase quando um SQL ficou preso (locks / query longa)
-- Rode cada bloco separado no SQL Editor.

-- 1) Ver queries ativas (procure duration grande e state = active)
select
  pid,
  usename,
  state,
  wait_event_type,
  wait_event,
  now() - query_start as duration,
  left(query, 200) as query_preview
from pg_stat_activity
where datname = current_database()
  and pid <> pg_backend_pid()
  and state <> 'idle'
order by query_start;

-- 2) Ver quem está bloqueando quem
select
  blocked.pid as blocked_pid,
  blocked.usename as blocked_user,
  now() - blocked.query_start as blocked_duration,
  left(blocked.query, 120) as blocked_query,
  blocking.pid as blocking_pid,
  now() - blocking.query_start as blocking_duration,
  left(blocking.query, 120) as blocking_query
from pg_stat_activity blocked
join pg_stat_activity blocking
  on blocking.pid = any(pg_blocking_pids(blocked.pid))
where blocked.datname = current_database();

-- 3) Cancelar query presa (tente primeiro — mais suave)
-- Troque 12345 pelo pid da linha acima (alter table / update scheduled_posts)
-- select pg_cancel_backend(12345);

-- 4) Se cancel não funcionar em ~30s, force encerramento
-- select pg_terminate_backend(12345);
