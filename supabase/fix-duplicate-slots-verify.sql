-- Rode DEPOIS de fix-duplicate-slots-apply.sql — deve retornar 0 linhas

select
  coalesce(ia.ig_username, tt.username) as conta,
  sp.platform,
  sp.scheduled_at at time zone 'America/Sao_Paulo' as horario_br,
  count(*) as total
from scheduled_posts sp
left join instagram_accounts ia on ia.id = sp.account_id
left join tiktok_accounts tt on tt.id = sp.tiktok_account_id
where sp.status in ('pending', 'processing', 'retrying')
group by
  coalesce(ia.ig_username, tt.username),
  sp.platform,
  coalesce(sp.account_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(sp.tiktok_account_id, '00000000-0000-0000-0000-000000000000'::uuid),
  sp.scheduled_at
having count(*) > 1
order by horario_br;
