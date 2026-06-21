-- Estados finos do job (opcional — a UI deriva fase a partir de status + current_step + contadores).
-- Execute apenas se quiser expandir os CHECK constraints no banco.

alter table schedule_jobs drop constraint if exists schedule_jobs_status_check;
alter table schedule_jobs add constraint schedule_jobs_status_check
  check (status in (
    'queued',
    'processing',
    'completed',
    'partial_failed',
    'failed',
    'cancelled'
  ));

alter table schedule_jobs drop constraint if exists schedule_jobs_current_step_check;
alter table schedule_jobs add constraint schedule_jobs_current_step_check
  check (current_step in (
    'queued',
    'planning',
    'captions',
    'inserting',
    'completed'
  ));
