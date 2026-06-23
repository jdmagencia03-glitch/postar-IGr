-- Remove post de debug: @arquivoscuriosos3s — legenda "árvores conversam"
-- Seguro: só apaga posts não publicados dessa conta com essa legenda.

begin;

with account as (
  select id
  from instagram_accounts
  where lower(ig_username) = lower('arquivoscuriosos3s')
  limit 1
),
targets as (
  select sp.id
  from scheduled_posts sp
  join account a on sp.account_id = a.id
  where sp.status <> 'published'
    and (
      sp.caption ilike '%árvores conversam%'
      or sp.caption ilike '%arvores conversam%'
    )
),
deleted_logs as (
  delete from publish_logs
  where post_id in (select id from targets)
  returning post_id
),
deleted_errors as (
  delete from operational_errors
  where scheduled_post_id in (select id from targets)
  returning scheduled_post_id
)
delete from scheduled_posts sp
where sp.id in (select id from targets)
returning sp.id, sp.status, sp.scheduled_at, left(sp.caption, 100) as caption_preview;

commit;
