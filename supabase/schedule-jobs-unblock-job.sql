-- Destravar job de agendamento preso em saving_posts (sem tasks na fila)
-- Substitua o UUID abaixo se for outro job.

-- ========== CONFIG ==========
-- Job: 00dcc032-d212-4a9f-a6b7-445659db1be2

-- ========== 1. Destravar o job ==========
update schedule_jobs
set
  locked_by = null,
  lock_until = null,
  last_heartbeat_at = null,
  status = 'processing',
  current_step = 'inserting',
  error_message = null,
  updated_at = now()
where id = '00dcc032-d212-4a9f-a6b7-445659db1be2';

-- ========== 2. Itens presos em "processing" voltam para "queued" ==========
update schedule_job_items
set
  status = 'queued',
  error_message = null,
  updated_at = now()
where schedule_job_id = '00dcc032-d212-4a9f-a6b7-445659db1be2'
  and status = 'processing'
  and created_post_id is null;

-- ========== 3. Recalcular contadores do job ==========
update schedule_jobs sj
set
  completed_items = (
    select count(*) from schedule_job_items
    where schedule_job_id = sj.id and status = 'completed'
  ),
  failed_items = (
    select count(*) from schedule_job_items
    where schedule_job_id = sj.id and status = 'failed'
  ),
  processed_items = (
    select count(*) from schedule_job_items
    where schedule_job_id = sj.id and destinations is not null
  ),
  updated_at = now()
where sj.id = '00dcc032-d212-4a9f-a6b7-445659db1be2';

-- ========== 4. Criar tasks save_posts (chunks de 50) na fila ==========
do $$
declare
  v_job_id uuid := '00dcc032-d212-4a9f-a6b7-445659db1be2';
  v_owner_id text;
  v_account_key text;
  v_all_ids uuid[];
  v_chunk_ids uuid[];
  v_chunk_index int := 0;
  v_chunk_size int := 50;
  v_i int;
  v_n int;
begin
  select
    j.owner_id,
    coalesce(
      (j.config->'targets'->0->>'platform') || ':' || (j.config->'targets'->0->>'account_id'),
      case when j.account_id is not null then 'instagram:' || j.account_id::text end,
      case when j.tiktok_account_id is not null then 'tiktok:' || j.tiktok_account_id::text end,
      'owner:' || j.owner_id
    )
  into v_owner_id, v_account_key
  from schedule_jobs j
  where j.id = v_job_id;

  if v_owner_id is null then
    raise exception 'Job não encontrado: %', v_job_id;
  end if;

  select array_agg(id order by sort_order)
  into v_all_ids
  from schedule_job_items
  where schedule_job_id = v_job_id
    and destinations is not null
    and created_post_id is null
    and status in ('queued', 'processing', 'retrying');

  v_n := coalesce(array_length(v_all_ids, 1), 0);
  if v_n = 0 then
    raise notice 'Nenhum item pendente para save_posts';
    return;
  end if;

  v_i := 1;
  while v_i <= v_n loop
    v_chunk_ids := v_all_ids[v_i : least(v_i + v_chunk_size - 1, v_n)];

    insert into schedule_job_tasks (
      schedule_job_id,
      owner_id,
      account_key,
      phase,
      chunk_index,
      item_ids,
      status
    ) values (
      v_job_id,
      v_owner_id,
      v_account_key,
      'save_posts',
      v_chunk_index,
      v_chunk_ids,
      'pending'
    )
    on conflict (schedule_job_id, phase, chunk_index) do update
      set item_ids = excluded.item_ids,
          status = 'pending',
          locked_by = null,
          lock_until = null,
          error_message = null,
          updated_at = now();

    v_chunk_index := v_chunk_index + 1;
    v_i := v_i + v_chunk_size;
  end loop;

  raise notice 'Tasks save_posts criadas/atualizadas: % (itens pendentes: %)', v_chunk_index, v_n;
end $$;

-- ========== 5. Verificação ==========
select
  sj.id,
  sj.status,
  sj.current_step,
  sj.total_items,
  sj.processed_items,
  sj.completed_items,
  sj.failed_items,
  sj.locked_by,
  sj.lock_until
from schedule_jobs sj
where sj.id = '00dcc032-d212-4a9f-a6b7-445659db1be2';

select status, count(*) as total
from schedule_job_items
where schedule_job_id = '00dcc032-d212-4a9f-a6b7-445659db1be2'
group by status
order by status;

select phase, status, count(*) as total
from schedule_job_tasks
where schedule_job_id = '00dcc032-d212-4a9f-a6b7-445659db1be2'
group by phase, status
order by phase, status;

select count(*) as posts_no_calendario
from scheduled_posts sp
join schedule_jobs sj on sj.upload_batch_id = sp.upload_batch_id
where sj.id = '00dcc032-d212-4a9f-a6b7-445659db1be2';
