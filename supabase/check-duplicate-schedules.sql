-- Diagnóstico: duplicatas e republicação em TODOS os perfis conectados
-- Instagram + TikTok · todas as contas do banco (todos os logins/owners)
-- Rode no SQL Editor do Supabase

-- =============================================================================
-- PASSO 0 — Todas as contas conectadas (deve listar cada perfil do app)
-- =============================================================================
select
  'instagram'::text as platform,
  ia.id as account_id,
  ia.owner_id,
  coalesce(ia.ig_username, 'sem_username') as perfil,
  ia.created_at as conectado_em
from instagram_accounts ia
union all
select
  'tiktok',
  ta.id,
  ta.owner_id,
  coalesce(ta.username, ta.display_name, ta.open_id, 'sem_username'),
  ta.created_at
from tiktok_accounts ta
order by platform, perfil;

-- =============================================================================
-- PASSO 1 — RESUMO por perfil (inclui contas sem problema = zeros)
-- =============================================================================
with contas as (
  select
    'instagram'::text as platform,
    ia.id as account_id,
    ia.owner_id,
    coalesce(ia.ig_username, ia.id::text) as perfil
  from instagram_accounts ia
  union all
  select
    'tiktok',
    ta.id,
    ta.owner_id,
    coalesce(ta.username, ta.display_name, ta.open_id, ta.id::text)
  from tiktok_accounts ta
),
posts as (
  select
    sp.id,
    sp.status,
    sp.scheduled_at,
    sp.media_urls,
    coalesce(sp.platform, 'instagram') as platform,
    coalesce(sp.account_id, sp.tiktok_account_id) as account_id
  from scheduled_posts sp
),
fila_duplicada as (
  select
    p.platform,
    p.account_id,
    p.media_urls[1] as video_url,
    count(*) as qtd
  from posts p
  where p.status in ('pending', 'processing')
  group by p.platform, p.account_id, p.media_urls[1]
  having count(*) > 1
),
rajada as (
  select
    p.platform,
    p.account_id,
    date_trunc('minute', p.scheduled_at at time zone 'America/Sao_Paulo') as minuto_br,
    count(*) as qtd
  from posts p
  where p.status in ('pending', 'processing')
  group by p.platform, p.account_id, date_trunc('minute', p.scheduled_at at time zone 'America/Sao_Paulo')
  having count(*) > 1
),
republicacao as (
  select
    p.platform,
    p.account_id,
    p.id as post_id,
    count(pl.id) filter (where pl.level = 'success') as logs_sucesso
  from posts p
  join publish_logs pl on pl.post_id = p.id
  group by p.platform, p.account_id, p.id
  having count(pl.id) filter (where pl.level = 'success') > 1
)
select
  c.platform,
  c.perfil,
  c.owner_id,
  coalesce(sum(fd.qtd), 0)::bigint as videos_duplicados_na_fila,
  count(distinct (r.minuto_br, r.qtd)) filter (where r.qtd is not null) as minutos_com_rajada,
  count(distinct rep.post_id) as posts_com_republicacao,
  coalesce(max(rep.logs_sucesso), 0)::bigint as max_logs_sucesso_em_um_post
from contas c
left join fila_duplicada fd
  on fd.platform = c.platform and fd.account_id = c.account_id
left join rajada r
  on r.platform = c.platform and r.account_id = c.account_id
left join republicacao rep
  on rep.platform = c.platform and rep.account_id = c.account_id
group by c.platform, c.perfil, c.owner_id, c.account_id
order by
  posts_com_republicacao desc,
  videos_duplicados_na_fila desc,
  c.platform,
  c.perfil;

-- =============================================================================
-- PASSO 2 — DETALHE: mesmo vídeo na fila mais de uma vez (todos os perfis)
-- =============================================================================
select
  coalesce(sp.platform, 'instagram') as platform,
  coalesce(ia.ig_username, ta.username, ta.display_name, 'sem_perfil') as perfil,
  coalesce(ia.owner_id, ta.owner_id) as owner_id,
  left(sp.media_urls[1], 90) as video_url,
  count(*) as fila_duplicada,
  array_agg(sp.id order by sp.created_at) as post_ids,
  array_agg(sp.scheduled_at order by sp.created_at) as horarios
from scheduled_posts sp
left join instagram_accounts ia on ia.id = sp.account_id
left join tiktok_accounts ta on ta.id = sp.tiktok_account_id
where sp.status in ('pending', 'processing')
group by
  coalesce(sp.platform, 'instagram'),
  coalesce(ia.ig_username, ta.username, ta.display_name, 'sem_perfil'),
  coalesce(ia.owner_id, ta.owner_id),
  sp.media_urls[1]
having count(*) > 1
order by fila_duplicada desc, perfil;

-- =============================================================================
-- PASSO 3 — DETALHE: rajada (2+ posts no mesmo minuto, todos os perfis)
-- =============================================================================
select
  coalesce(sp.platform, 'instagram') as platform,
  coalesce(ia.ig_username, ta.username, ta.display_name, 'sem_perfil') as perfil,
  coalesce(ia.owner_id, ta.owner_id) as owner_id,
  date_trunc('minute', sp.scheduled_at at time zone 'America/Sao_Paulo') as minuto_br,
  count(*) as posts_no_minuto,
  array_agg(sp.id order by sp.scheduled_at) as post_ids
from scheduled_posts sp
left join instagram_accounts ia on ia.id = sp.account_id
left join tiktok_accounts ta on ta.id = sp.tiktok_account_id
where sp.status in ('pending', 'processing')
group by
  coalesce(sp.platform, 'instagram'),
  coalesce(ia.ig_username, ta.username, ta.display_name, 'sem_perfil'),
  coalesce(ia.owner_id, ta.owner_id),
  date_trunc('minute', sp.scheduled_at at time zone 'America/Sao_Paulo')
having count(*) > 1
order by minuto_br desc, perfil;

-- =============================================================================
-- PASSO 4 — DETALHE: loop de republicação (todos os perfis)
-- Ex.: deolhonoshape3s com 44 logs = incidente antigo de republicação
-- =============================================================================
select
  sp.id,
  coalesce(sp.platform, 'instagram') as platform,
  coalesce(ia.ig_username, ta.username, ta.display_name, 'sem_perfil') as perfil,
  coalesce(ia.owner_id, ta.owner_id) as owner_id,
  sp.status,
  sp.scheduled_at,
  sp.media_id,
  count(pl.id) filter (where pl.level = 'success') as logs_sucesso,
  max(pl.created_at) filter (where pl.level = 'success') as ultimo_sucesso
from scheduled_posts sp
left join instagram_accounts ia on ia.id = sp.account_id
left join tiktok_accounts ta on ta.id = sp.tiktok_account_id
left join publish_logs pl on pl.post_id = sp.id
group by
  sp.id,
  coalesce(sp.platform, 'instagram'),
  coalesce(ia.ig_username, ta.username, ta.display_name, 'sem_perfil'),
  coalesce(ia.owner_id, ta.owner_id),
  sp.status,
  sp.scheduled_at,
  sp.media_id
having count(pl.id) filter (where pl.level = 'success') > 1
order by logs_sucesso desc, perfil, sp.scheduled_at desc;

-- =============================================================================
-- PASSO 5 (opcional) — Bloquear fila com republicação detectada · TODAS as contas
-- =============================================================================
/*
update scheduled_posts sp
set
  status = 'failed',
  error_message = 'Republicação detectada nos logs. Bloqueado — verifique o Instagram/TikTok.'
where sp.status in ('pending', 'processing')
  and sp.media_id is null
  and exists (
    select 1
    from publish_logs pl
    where pl.post_id = sp.id
      and pl.level = 'success'
  );
*/
