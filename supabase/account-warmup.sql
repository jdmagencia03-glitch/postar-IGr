-- Aquecimento de contas novas (rampa nos primeiros dias)
alter table instagram_accounts
  add column if not exists warmup_enabled boolean not null default true,
  add column if not exists warmup_days int not null default 5,
  add column if not exists warmup_started_at timestamptz;

update instagram_accounts
set warmup_started_at = coalesce(warmup_started_at, created_at)
where warmup_started_at is null;
