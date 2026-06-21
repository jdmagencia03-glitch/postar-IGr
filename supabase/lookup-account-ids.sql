-- Confirmar UUIDs das contas antes do hotfix de horários
select
  'instagram'::text as platform,
  id as account_id,
  ig_username as handle
from instagram_accounts
where lower(replace(coalesce(ig_username, ''), '@', '')) = 'deolhonoshape3s'

union all

select
  'tiktok'::text as platform,
  id as account_id,
  username as handle
from tiktok_accounts
where lower(replace(coalesce(username, ''), '@', '')) = 'paporetootv';
