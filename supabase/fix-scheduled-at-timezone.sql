-- Corrige posts futuros salvos 3h adiantado (UTC tratado como Brasília)
-- Prévia antes de aplicar:

select
  sp.id,
  sp.scheduled_at as utc_atual,
  sp.scheduled_at at time zone 'America/Sao_Paulo' as exibicao_errada_brt,
  (sp.scheduled_at + interval '3 hours') as utc_corrigido,
  (sp.scheduled_at + interval '3 hours') at time zone 'America/Sao_Paulo' as exibicao_corrigida_brt
from scheduled_posts sp
where sp.status in ('pending', 'retrying', 'processing')
  and sp.scheduled_at > now()
  and sp.upload_batch_id = (
    select upload_batch_id from schedule_jobs
    where id = '00dcc032-d212-4a9f-a6b7-445659db1be2'
  )
order by sp.scheduled_at
limit 20;

-- Aplicar correção (+3h UTC) apenas posts futuros do lote
update scheduled_posts sp
set
  scheduled_at = sp.scheduled_at + interval '3 hours',
  updated_at = now()
where sp.status in ('pending', 'retrying', 'processing')
  and sp.scheduled_at > now()
  and sp.upload_batch_id = (
    select upload_batch_id from schedule_jobs
    where id = '00dcc032-d212-4a9f-a6b7-445659db1be2'
  );

-- Corrigir destinations nos itens do job (JSON)
update schedule_job_items sji
set
  destinations = (
    select jsonb_agg(
      elem || jsonb_build_object(
        'scheduled_at',
        to_char(
          (elem->>'scheduled_at')::timestamptz + interval '3 hours',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
        )
      )
    )
    from jsonb_array_elements(sji.destinations) elem
  ),
  scheduled_at = case
    when sji.scheduled_at is not null then sji.scheduled_at + interval '3 hours'
    else sji.scheduled_at
  end,
  updated_at = now()
where sji.schedule_job_id = '00dcc032-d212-4a9f-a6b7-445659db1be2'
  and sji.destinations is not null
  and sji.status in ('queued', 'processing', 'completed', 'retrying');

select count(*) as posts_corrigidos
from scheduled_posts sp
where sp.upload_batch_id = (
  select upload_batch_id from schedule_jobs where id = '00dcc032-d212-4a9f-a6b7-445659db1be2'
);
