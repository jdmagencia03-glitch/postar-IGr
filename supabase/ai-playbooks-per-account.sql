-- Playbooks isolados por conta (execute no SQL Editor do Supabase)
alter table ai_playbooks
  add column if not exists playbooks_by_account jsonb not null default '{}'::jsonb;
