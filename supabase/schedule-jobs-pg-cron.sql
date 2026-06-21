-- Worker em background via pg_cron (Supabase Pro ou extensões habilitadas)
-- Substitua YOUR_CRON_SECRET e a URL de produção antes de executar.

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

select cron.unschedule(jobid)
from cron.job
where jobname = 'postarigr-schedule-jobs';

select cron.schedule(
  'postarigr-schedule-jobs',
  '*/2 * * * *',
  $$
  select net.http_post(
    url := 'https://postarigr.vercel.app/api/cron/schedule-jobs',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer YOUR_CRON_SECRET'
    ),
    body := '{}'::jsonb
  ) as request_id;
  $$
);
