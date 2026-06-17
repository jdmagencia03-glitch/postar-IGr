-- Automação: comentário com palavra-chave → DM (Private Reply API Meta)

create table if not exists comment_dm_automations (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null,
  account_id uuid not null references instagram_accounts(id) on delete cascade,
  name text not null default 'Automação DM',
  enabled boolean not null default true,
  dm_message_template text not null,
  dm_link text,
  apply_to text not null default 'all'
    check (apply_to in ('all', 'specific')),
  target_media_ids text[] not null default '{}',
  keywords text[] not null default '{}',
  total_comments_detected bigint not null default 0,
  total_dms_sent bigint not null default 0,
  total_failures bigint not null default 0,
  last_polled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_comment_dm_automations_owner
  on comment_dm_automations(owner_id);

create index if not exists idx_comment_dm_automations_account_enabled
  on comment_dm_automations(account_id, enabled)
  where enabled = true;

create table if not exists comment_dm_events (
  id uuid primary key default gen_random_uuid(),
  automation_id uuid not null references comment_dm_automations(id) on delete cascade,
  account_id uuid not null references instagram_accounts(id) on delete cascade,
  owner_id text not null,
  comment_id text not null,
  media_id text,
  commenter_ig_id text,
  commenter_username text,
  comment_text text,
  matched_keyword text,
  rendered_message text,
  status text not null default 'pending'
    check (status in ('pending', 'sent', 'failed', 'skipped')),
  error_message text,
  api_response jsonb,
  source text not null default 'webhook'
    check (source in ('webhook', 'poll', 'manual')),
  comment_created_at timestamptz,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (comment_id)
);

create index if not exists idx_comment_dm_events_automation
  on comment_dm_events(automation_id, created_at desc);

create index if not exists idx_comment_dm_events_status
  on comment_dm_events(status, created_at)
  where status = 'pending';

create index if not exists idx_comment_dm_events_owner
  on comment_dm_events(owner_id, created_at desc);

alter table comment_dm_automations enable row level security;
alter table comment_dm_events enable row level security;
