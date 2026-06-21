-- Apply atômico de correção de horários (duas fases + transação).
-- Execute no Supabase SQL Editor ou via GET /api/cron/migrate-db?migration=apply-schedule-moves-atomic

create or replace function apply_schedule_moves_atomic(
  p_platform text,
  p_account_id uuid,
  p_moves jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_move record;
  v_i int := 0;
  v_temp timestamptz;
  v_updated int := 0;
begin
  if p_moves is null or jsonb_array_length(p_moves) = 0 then
    return jsonb_build_object('ok', true, 'updated', 0);
  end if;

  perform pg_advisory_xact_lock(
    hashtext('apply_schedule_moves:' || p_platform || ':' || p_account_id::text)
  );

  for v_move in
    select * from jsonb_to_recordset(p_moves) as x(post_id uuid, to_ts timestamptz)
  loop
    if not exists (
      select 1
      from scheduled_posts sp
      where sp.id = v_move.post_id
        and sp.status in ('pending', 'processing', 'retrying')
        and (
          (p_platform = 'tiktok' and sp.platform = 'tiktok' and sp.tiktok_account_id = p_account_id)
          or (
            p_platform = 'instagram'
            and sp.account_id = p_account_id
            and coalesce(sp.platform, 'instagram') <> 'tiktok'
          )
        )
    ) then
      raise exception 'post_not_in_scope: %', v_move.post_id;
    end if;
  end loop;

  if exists (
    select to_ts
    from jsonb_to_recordset(p_moves) as x(post_id uuid, to_ts timestamptz)
    group by to_ts
    having count(*) > 1
  ) then
    raise exception 'duplicate_target_slots_in_moves';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_moves) as m(post_id uuid, to_ts timestamptz)
    join scheduled_posts sp
      on sp.scheduled_at = m.to_ts
      and sp.status in ('pending', 'processing', 'retrying')
      and sp.id <> m.post_id
      and (
        (p_platform = 'tiktok' and sp.platform = 'tiktok' and sp.tiktok_account_id = p_account_id)
        or (
          p_platform = 'instagram'
          and sp.account_id = p_account_id
          and coalesce(sp.platform, 'instagram') <> 'tiktok'
        )
      )
    where not exists (
      select 1
      from jsonb_to_recordset(p_moves) as inner_m(post_id uuid, to_ts timestamptz)
      where inner_m.post_id = sp.id
    )
  ) then
    raise exception 'target_slot_occupied_by_external_post';
  end if;

  for v_move in
    select *
    from jsonb_to_recordset(p_moves) as x(post_id uuid, to_ts timestamptz)
    order by post_id
  loop
    v_temp := timestamptz '2099-01-01 00:00:00+00' + (v_i || ' minutes')::interval;
    update scheduled_posts
    set scheduled_at = v_temp, updated_at = now()
    where id = v_move.post_id
      and status in ('pending', 'processing', 'retrying');
    v_i := v_i + 1;
  end loop;

  for v_move in
    select *
    from jsonb_to_recordset(p_moves) as x(post_id uuid, to_ts timestamptz)
    order by post_id
  loop
    update scheduled_posts
    set scheduled_at = v_move.to_ts, updated_at = now()
    where id = v_move.post_id
      and status in ('pending', 'processing', 'retrying');
    v_updated := v_updated + 1;
  end loop;

  return jsonb_build_object('ok', true, 'updated', v_updated);
end;
$$;
