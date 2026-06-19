-- Corrige owner_id de schedule_jobs (sessão Meta = text, não auth.users uuid)
-- Execute se você já rodou schedule-jobs.sql com a FK antiga em auth.users

alter table schedule_jobs drop constraint if exists schedule_jobs_owner_id_fkey;

alter table schedule_jobs
  alter column owner_id type text using owner_id::text;
