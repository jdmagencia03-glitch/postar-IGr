-- Estado de pipeline por item (legendas/hashtags) — idempotente, seguro para reexecutar.
-- Idempotente — seguro reexecutar. Adiciona pipeline jsonb por item em schedule_job_items.

alter table schedule_job_items
  add column if not exists pipeline jsonb default '{}'::jsonb;

update schedule_job_items
set pipeline = '{}'::jsonb
where pipeline is null;

alter table schedule_job_items
  alter column pipeline set default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'schedule_job_items_pipeline_object'
  ) then
    alter table schedule_job_items
      add constraint schedule_job_items_pipeline_object
      check (jsonb_typeof(pipeline) = 'object');
  end if;
end $$;

create index if not exists idx_schedule_job_items_pipeline_caption
  on schedule_job_items (schedule_job_id, ((pipeline ->> 'caption_status')));

create index if not exists idx_schedule_job_items_pipeline_hashtags
  on schedule_job_items (schedule_job_id, ((pipeline ->> 'hashtags_status')));
