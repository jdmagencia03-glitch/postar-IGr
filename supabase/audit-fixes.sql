-- Histórico de correções do agente de auditoria (rollback futuro)
create table if not exists audit_fixes (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null,
  admin_id text not null,
  action text not null,
  dry_run boolean not null default true,
  platform text check (platform in ('instagram', 'tiktok', 'system')),
  account_id uuid,
  affected_rows int not null default 0,
  before_snapshot jsonb,
  after_snapshot jsonb,
  rollback_available boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_audit_fixes_owner on audit_fixes(owner_id, created_at desc);
