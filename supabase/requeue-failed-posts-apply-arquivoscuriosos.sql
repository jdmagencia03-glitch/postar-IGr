-- APLICAR: fila de retry @arquivoscuriosos3s (20 min entre posts)
-- Usa status = pending (não precisa migration). Seguro para rodar agora.

with params as (
  select 'arquivoscuriosos3s'::text as username, 20 as interval_minutes
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
    and sp.status in ('failed', 'retrying', 'processing')
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
