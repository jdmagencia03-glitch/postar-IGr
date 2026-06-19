-- Central de Erros: erros operacionais agrupados por fingerprint
-- Execute no SQL Editor do Supabase

create table if not exists operational_errors (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null,
  fingerprint text not null,
  account_id text,
  platform text,
  content_type text,
  upload_batch_id uuid references upload_batches(id) on delete set null,
  upload_file_id uuid references upload_files(id) on delete set null,
  scheduled_post_id uuid references scheduled_posts(id) on delete set null,
  error_type text not null,
  category text not null check (category in ('upload', 'scheduling', 'publishing', 'account', 'ai', 'system')),
  severity text not null check (severity in ('critical', 'high', 'medium', 'low')),
  status text not null default 'open' check (
    status in ('open', 'investigating', 'auto_retrying', 'resolved', 'ignored', 'needs_user_action')
  ),
  title text not null,
  message text not null,
  technical_message text,
  probable_cause text,
  recommended_action text,
  metadata jsonb not null default '{}',
  available_actions jsonb not null default '[]',
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  resolved_at timestamptz,
  retry_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_operational_errors_open_fingerprint
  on operational_errors(owner_id, fingerprint)
  where status not in ('resolved', 'ignored');

create index if not exists idx_operational_errors_owner_status
  on operational_errors(owner_id, status, last_seen_at desc);

create index if not exists idx_operational_errors_owner_category
  on operational_errors(owner_id, category, severity);

create index if not exists idx_operational_errors_batch
  on operational_errors(upload_batch_id)
  where upload_batch_id is not null;

create index if not exists idx_operational_errors_post
  on operational_errors(scheduled_post_id)
  where scheduled_post_id is not null;

alter table operational_errors enable row level security;
