-- Corrige horários duplicados ANTES de criar unique_active_scheduled_slot.
-- Rode cada bloco separado no SQL Editor (Preview → Apply → Verify → Index).

-- =============================================================================
-- PASSO 1 — PRÉVIA: quantos slots duplicados existem?
-- =============================================================================
select
  coalesce(ia.ig_username, tt.username, 'sem-nome') as conta,
  sp.platform,
  sp.scheduled_at at time zone 'America/Sao_Paulo' as horario_br,
  count(*) as posts_no_mesmo_slot,
  array_agg(sp.id order by sp.created_at, sp.id) as post_ids
from scheduled_posts sp
left join instagram_accounts ia on ia.id = sp.account_id
left join tiktok_accounts tt on tt.id = sp.tiktok_account_id
where sp.status in ('pending', 'processing', 'retrying')
group by
  coalesce(ia.ig_username, tt.username, 'sem-nome'),
  sp.platform,
  coalesce(sp.account_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(sp.tiktok_account_id, '00000000-0000-0000-0000-000000000000'::uuid),
  sp.scheduled_at
having count(*) > 1
order by horario_br;

-- =============================================================================
-- PASSO 2 — APLICAR: mantém o post mais antigo; move os demais +1 dia cada
-- (seguro: não cria novo conflito no mesmo instante)
-- =============================================================================
/*
with ranked as (
  select
    sp.id,
    sp.scheduled_at,
    row_number() over (
      partition by
        coalesce(sp.account_id, '00000000-0000-0000-0000-000000000000'::uuid),
        coalesce(sp.tiktok_account_id, '00000000-0000-0000-0000-000000000000'::uuid),
        coalesce(sp.platform, 'instagram'),
        sp.scheduled_at
      order by sp.created_at asc nulls last, sp.id asc
    ) as dup_pos
  from scheduled_posts sp
  where sp.status in ('pending', 'processing', 'retrying')
)
update scheduled_posts sp
set
  scheduled_at = sp.scheduled_at + ((r.dup_pos - 1) * interval '1 day'),
  updated_at = now()
from ranked r
where sp.id = r.id
  and r.dup_pos > 1;
*/

-- =============================================================================
-- PASSO 3 — VERIFICAR: deve retornar 0 linhas
-- =============================================================================
/*
select
  coalesce(account_id::text, tiktok_account_id::text) as conta,
  platform,
  scheduled_at at time zone 'America/Sao_Paulo' as horario_br,
  count(*) as total
from scheduled_posts
where status in ('pending', 'processing', 'retrying')
group by 1, platform, scheduled_at
having count(*) > 1;
*/

-- =============================================================================
-- PASSO 4 — CRIAR ÍNDICE (só depois do PASSO 3 vazio)
-- =============================================================================
/*
create unique index if not exists unique_active_scheduled_slot
on scheduled_posts (
  coalesce(account_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(tiktok_account_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(platform, 'instagram'),
  scheduled_at
)
where status in ('pending', 'processing', 'retrying');
*/
