-- Histórico e monitoramento do Agente de Diagnóstico Admin
-- Execute no SQL Editor do Supabase

create table if not exists audit_findings (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null,
  fingerprint text not null,
  severity text not null check (severity in ('critical', 'high', 'medium', 'low')),
  module text not null,
  platform text not null,
  account_id uuid,
  account_handle text,
  title text not null,
  description text not null,
  evidence jsonb not null default '{}'::jsonb,
  probable_cause text not null default '',
  recommended_fix text not null default '',
  status text not null default 'open' check (
    status in ('open', 'validating', 'resolved', 'ignored', 'reopened')
  ),
  occurrence_count int not null default 1,
  validation_count int not null default 0,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  resolved_at timestamptz,
  reopened_at timestamptz,
  ignored_at timestamptz,
  last_validated_at timestamptz,
  last_validated_by text,
  last_validation_result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, fingerprint)
);

create index if not exists idx_audit_findings_owner_status
  on audit_findings(owner_id, status, last_seen_at desc);

create index if not exists idx_audit_findings_owner_module
  on audit_findings(owner_id, module, platform);

create table if not exists audit_sweep_meta (
  owner_id text primary key,
  last_critical_sweep_at timestamptz,
  last_schedule_sweep_at timestamptz,
  last_full_sweep_at timestamptz,
  open_count int not null default 0,
  resolved_today_count int not null default 0,
  reopened_count int not null default 0,
  updated_at timestamptz not null default now()
);
