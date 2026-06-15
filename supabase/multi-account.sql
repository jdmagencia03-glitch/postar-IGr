-- Execute no SQL Editor do Supabase para habilitar múltiplas contas Instagram
-- https://supabase.com/dashboard

alter table instagram_accounts
  add column if not exists owner_id text;

update instagram_accounts
set owner_id = user_id
where owner_id is null;

create index if not exists idx_instagram_accounts_owner_id
  on instagram_accounts(owner_id);
