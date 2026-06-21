-- APLICAR: corrige duplicados movendo extras para fila livre (+20 min no fim).
-- NÃO use em contas com schedule_mode = 'warmup' (ex.: @paporetootv TikTok).
-- Para aquecimento, use a API POST /api/scheduled-posts/fix-duplicate-slots
-- ou POST /api/scheduled-posts/redistribute-warmup (apply: true).
-- Depois rode verify + index.

with active as (
  select
    sp.id,
    sp.scheduled_at,
    sp.created_at,
    coalesce(sp.account_id, '00000000-0000-0000-0000-000000000000'::uuid) as acc_ig,
    coalesce(sp.tiktok_account_id, '00000000-0000-0000-0000-000000000000'::uuid) as acc_tt,
    coalesce(sp.platform, 'instagram') as platform
  from scheduled_posts sp
  where sp.status in ('pending', 'processing', 'retrying')
),
ranked as (
  select
    a.*,
    row_number() over (
      partition by a.acc_ig, a.acc_tt, a.platform, a.scheduled_at
      order by a.created_at asc nulls last, a.id asc
    ) as dup_pos
  from active a
),
to_move as (
  select
    r.id,
    r.dup_pos,
    row_number() over (
      partition by r.acc_ig, r.acc_tt, r.platform
      order by r.scheduled_at, r.dup_pos
    ) as move_seq
  from ranked r
  where r.dup_pos > 1
),
account_tail as (
  select
    coalesce(sp.account_id, '00000000-0000-0000-0000-000000000000'::uuid) as acc_ig,
    coalesce(sp.tiktok_account_id, '00000000-0000-0000-0000-000000000000'::uuid) as acc_tt,
    coalesce(sp.platform, 'instagram') as platform,
    max(sp.scheduled_at) as tail_at
  from scheduled_posts sp
  where sp.status in ('pending', 'processing', 'retrying')
  group by 1, 2, 3
),
planned as (
  select
    tm.id,
    at.tail_at + (tm.move_seq * interval '20 minutes') as new_at
  from to_move tm
  join active a on a.id = tm.id
  join account_tail at
    on at.acc_ig = a.acc_ig
   and at.acc_tt = a.acc_tt
   and at.platform = a.platform
)
update scheduled_posts sp
set
  scheduled_at = p.new_at,
  updated_at = now()
from planned p
where sp.id = p.id
returning sp.id, p.new_at at time zone 'America/Sao_Paulo' as novo_horario_br;
