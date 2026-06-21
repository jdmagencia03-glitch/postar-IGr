-- Reagenda posts falhos em fila (1 tentativa a cada 20 min)
-- Supabase SQL Editor — execute PASSO 1, confira, depois PASSO 2.

-- =============================================================================
-- PASSO 1 — PRÉVIA @deolhonoshape3s
-- =============================================================================
with params as (
  select 'deolhonoshape3s'::text as username, 20 as interval_minutes
),
account as (
  select ia.id as account_id, ia.ig_username
  from instagram_accounts ia
  cross join params p
  where lower(ia.ig_username) = lower(p.username)
  limit 1
),
targets as (
  select
    sp.id,
    sp.status,
    sp.scheduled_at,
    sp.error_message,
    row_number() over (order by sp.scheduled_at asc, sp.created_at asc) as queue_pos
  from scheduled_posts sp
  join account a on sp.account_id = a.account_id
  where sp.media_id is null
    and coalesce(sp.platform, 'instagram') = 'instagram'
    and sp.status in ('failed', 'failed_persistent', 'retrying', 'processing')
)
select
  a.ig_username as conta,
  t.queue_pos,
  t.id,
  t.status as status_atual,
  t.scheduled_at at time zone 'America/Sao_Paulo' as agendado_br,
  left(t.error_message, 100) as erro,
  (now() + ((t.queue_pos - 1) * (p.interval_minutes || ' minutes')::interval))
    at time zone 'America/Sao_Paulo' as proxima_tentativa_br
from targets t
cross join account a
cross join params p
order by t.queue_pos;

-- =============================================================================
-- PASSO 2 — APLICAR @deolhonoshape3s (cole e rode só este bloco após conferir)
-- =============================================================================
/*
with params as (
  select 'deolhonoshape3s'::text as username, 20 as interval_minutes
),
account as (
  select ia.id as account_id, ia.ig_username
  from instagram_accounts ia
  cross join params p
  where lower(ia.ig_username) = lower(p.username)
  limit 1
),
targets as (
  select
    sp.id,
    row_number() over (order by sp.scheduled_at asc, sp.created_at asc) as queue_pos
  from scheduled_posts sp
  join account a on sp.account_id = a.account_id
  where sp.media_id is null
    and coalesce(sp.platform, 'instagram') = 'instagram'
    and sp.status in ('failed', 'failed_persistent', 'retrying', 'processing')
),
queued as (
  select
    t.id,
    now() + ((t.queue_pos - 1) * (p.interval_minutes || ' minutes')::interval) as next_at
  from targets t
  cross join params p
),
updated as (
  update scheduled_posts sp
  set
    status = 'pending',
    scheduled_at = q.next_at,
    retry_count = 0,
    next_retry_at = null,
    error_message = null,
    updated_at = now()
  from queued q
  where sp.id = q.id
    and sp.media_id is null
  returning sp.id, q.next_at
)
select
  (select ig_username from account) as conta,
  count(*) as posts_reagendados,
  min(u.next_at) at time zone 'America/Sao_Paulo' as primeira_tentativa_br,
  max(u.next_at) at time zone 'America/Sao_Paulo' as ultima_tentativa_br
from updated u;
*/

-- =============================================================================
-- OPCIONAL — @arquivoscuriosos3s (3 posts interrompidos)
-- =============================================================================
/*
with params as (
  select 'arquivoscuriosos3s'::text as username, 20 as interval_minutes
),
account as (
  select ia.id as account_id
  from instagram_accounts ia
  cross join params p
  where lower(ia.ig_username) = lower(p.username)
  limit 1
),
targets as (
  select
    sp.id,
    row_number() over (order by sp.scheduled_at asc, sp.created_at asc) as queue_pos
  from scheduled_posts sp
  join account a on sp.account_id = a.account_id
  where sp.media_id is null
    and coalesce(sp.platform, 'instagram') = 'instagram'
    and sp.status in ('failed', 'failed_persistent', 'retrying', 'processing')
),
queued as (
  select
    t.id,
    now() + ((t.queue_pos - 1) * (p.interval_minutes || ' minutes')::interval) as next_at
  from targets t
  cross join params p
)
update scheduled_posts sp
set
  status = 'pending',
  scheduled_at = q.next_at,
  retry_count = 0,
  next_retry_at = null,
  error_message = null,
  updated_at = now()
from queued q
where sp.id = q.id
  and sp.media_id is null;
*/
