-- Corrigir job que mostra 429/429 mas posts não aparecem na central de operações
-- Job: 00dcc032-d212-4a9f-a6b7-445659db1be2

-- 1) Diagnóstico
select
  (select count(*) from scheduled_posts sp
   join schedule_jobs sj on sp.upload_batch_id = sj.upload_batch_id
   where sj.id = '00dcc032-d212-4a9f-a6b7-445659db1be2') as posts_reais,
  (select count(*) from schedule_job_items
   where schedule_job_id = '00dcc032-d212-4a9f-a6b7-445659db1be2'
     and status = 'completed' and created_post_id is not null) as itens_com_post,
  (select count(*) from schedule_job_items
   where schedule_job_id = '00dcc032-d212-4a9f-a6b7-445659db1be2'
     and status = 'completed' and created_post_id is null) as itens_fantasma;

-- 2) Reset itens "completed" sem post real → volta para fila
update schedule_job_items
set status = 'queued', error_message = null, updated_at = now()
where schedule_job_id = '00dcc032-d212-4a9f-a6b7-445659db1be2'
  and status = 'completed'
  and created_post_id is null
  and destinations is not null;

-- 3) Recalcular job (volta para processing se faltam posts)
update schedule_jobs sj
set
  completed_items = (
    select count(*) from schedule_job_items
    where schedule_job_id = sj.id and status = 'completed' and created_post_id is not null
  ),
  failed_items = (
    select count(*) from schedule_job_items
    where schedule_job_id = sj.id and status = 'failed'
  ),
  processed_items = (
    select count(*) from schedule_job_items
    where schedule_job_id = sj.id and destinations is not null
  ),
  status = case
    when (select count(*) from schedule_job_items
          where schedule_job_id = sj.id and status = 'completed' and created_post_id is not null)
         >= sj.total_items then 'completed'
    else 'processing'
  end,
  current_step = case
    when (select count(*) from schedule_job_items
          where schedule_job_id = sj.id and status = 'completed' and created_post_id is not null)
         >= sj.total_items then 'completed'
    else 'inserting'
  end,
  completed_at = case
    when (select count(*) from schedule_job_items
          where schedule_job_id = sj.id and status = 'completed' and created_post_id is not null)
         >= sj.total_items then coalesce(sj.completed_at, now())
    else null
  end,
  updated_at = now()
where sj.id = '00dcc032-d212-4a9f-a6b7-445659db1be2';

-- 4) Depois rode no app (logado, DevTools):
-- fetch('/api/schedule-jobs/00dcc032-d212-4a9f-a6b7-445659db1be2/finalize-posts', { method: 'POST', credentials: 'include' }).then(r=>r.json()).then(console.log)
-- Repita 2–3x até savedThisRun parar de subir.
