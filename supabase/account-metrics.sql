-- Histórico de seguidores para calcular ganho real ao longo do tempo
create table if not exists account_metrics_snapshots (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references instagram_accounts(id) on delete cascade,
  followers_count int not null,
  recorded_at timestamptz not null default now()
);

create index if not exists idx_account_metrics_account_time
  on account_metrics_snapshots(account_id, recorded_at desc);
