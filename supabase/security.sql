-- Segurança: auditoria + RLS (defense-in-depth)
-- Execute no SQL Editor do Supabase

create table if not exists security_audit_logs (
  id uuid primary key default gen_random_uuid(),
  owner_id text,
  event_type text not null,
  resource_type text,
  resource_id text,
  ip_address text,
  user_agent text,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_security_audit_logs_owner_created
  on security_audit_logs(owner_id, created_at desc);

create index if not exists idx_security_audit_logs_event_created
  on security_audit_logs(event_type, created_at desc);

alter table instagram_accounts enable row level security;
alter table scheduled_posts enable row level security;
alter table app_sessions enable row level security;
alter table oauth_states enable row level security;
alter table publish_logs enable row level security;
alter table ai_playbooks enable row level security;
alter table upload_batches enable row level security;
alter table upload_files enable row level security;
alter table security_audit_logs enable row level security;

-- Sem policies para anon/authenticated: acesso negado por padrão.
-- O backend usa service role, que bypassa RLS no Supabase.
