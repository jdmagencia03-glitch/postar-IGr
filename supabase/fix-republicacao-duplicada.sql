-- PostarIG — Corrigir posts do incidente de republicação duplicada
-- Cole TUDO no SQL Editor do Supabase e execute por partes (ou tudo de uma vez).
--
-- O que faz:
-- 1) Mostra posts suspeitos (pendentes/processando com log de sucesso)
-- 2) Bloqueia republicação desses posts (marca como falha com mensagem clara)
-- 3) Cria índices de proteção (publish-guard)
-- 4) Mostra resumo final

-- =============================================================================
-- PASSO 1 — DIAGNÓSTICO (rode primeiro para ver o que será alterado)
-- =============================================================================

-- Posts que já publicaram no IG (log de sucesso) mas ainda estão na fila
select
  sp.id,
  sp.status,
  sp.scheduled_at,
  sp.media_id,
  sp.caption,
  left(sp.media_urls[1], 80) as video_url,
  count(pl.id) filter (where pl.level = 'success') as logs_sucesso,
  max(pl.created_at) filter (where pl.level = 'success') as ultimo_sucesso
from scheduled_posts sp
join publish_logs pl on pl.post_id = sp.id
where sp.status in ('pending', 'processing')
  and sp.media_id is null
group by sp.id
order by logs_sucesso desc, sp.scheduled_at;

-- Contagem rápida
select
  count(distinct sp.id) as posts_para_bloquear
from scheduled_posts sp
where sp.status in ('pending', 'processing')
  and sp.media_id is null
  and exists (
    select 1
    from publish_logs pl
    where pl.post_id = sp.id
      and pl.level = 'success'
  );

-- =============================================================================
-- PASSO 2 — CORREÇÃO (bloqueia republicação dos posts do incidente)
-- =============================================================================

update scheduled_posts sp
set
  status = 'failed',
  error_message = 'Incidente de republicação: publicação detectada nos logs. Bloqueado por segurança — verifique o Instagram e exclua da fila se necessário.'
where sp.status in ('pending', 'processing')
  and sp.media_id is null
  and exists (
    select 1
    from publish_logs pl
    where pl.post_id = sp.id
      and pl.level = 'success'
  );

-- Posts com MUITOS logs de sucesso (provável loop — ex.: ~50 republicações)
-- Descomente se quiser marcar só os mais críticos (3+ sucessos):
/*
update scheduled_posts sp
set
  status = 'failed',
  error_message = 'Loop de republicação detectado (3+ publicações nos logs). Bloqueado permanentemente.'
where sp.status in ('pending', 'processing')
  and sp.media_id is null
  and (
    select count(*)
    from publish_logs pl
    where pl.post_id = sp.id
      and pl.level = 'success'
  ) >= 3;
*/

-- =============================================================================
-- PASSO 3 — ÍNDICES DE PROTEÇÃO (opcional, recomendado)
-- =============================================================================

create index if not exists idx_scheduled_posts_pending_no_media
  on scheduled_posts(scheduled_at)
  where status = 'pending' and media_id is null;

create index if not exists idx_publish_logs_post_success
  on publish_logs(post_id)
  where level = 'success';

create index if not exists idx_scheduled_posts_media_id
  on scheduled_posts(media_id)
  where media_id is not null;

-- =============================================================================
-- PASSO 4 — VERIFICAÇÃO FINAL
-- =============================================================================

select status, count(*) as total
from scheduled_posts
group by status
order by status;

-- Não deve retornar linhas após a correção:
select sp.id, sp.status, count(pl.id) as logs_sucesso
from scheduled_posts sp
join publish_logs pl on pl.post_id = sp.id and pl.level = 'success'
where sp.status in ('pending', 'processing')
  and sp.media_id is null
group by sp.id, sp.status;
