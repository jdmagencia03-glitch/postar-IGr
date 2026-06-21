-- Cooldown por conta Instagram após rate limit / action block
alter table instagram_accounts
  add column if not exists cooldown_until timestamptz;

alter table instagram_accounts
  add column if not exists pause_reason text;

create index if not exists idx_instagram_accounts_cooldown_until
  on instagram_accounts (cooldown_until)
  where cooldown_until is not null;
