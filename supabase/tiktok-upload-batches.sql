-- Lotes de upload multi-plataforma
-- Execute no SQL Editor do Supabase

alter table upload_batches
  add column if not exists platform text not null default 'instagram'
    check (platform in ('instagram', 'tiktok'));

alter table upload_batches
  add column if not exists tiktok_account_id uuid references tiktok_accounts(id) on delete cascade;

alter table upload_batches
  alter column account_id drop not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'upload_batches_platform_account_check'
  ) then
    alter table upload_batches
      add constraint upload_batches_platform_account_check check (
        (platform = 'instagram' and account_id is not null and tiktok_account_id is null)
        or (platform = 'tiktok' and tiktok_account_id is not null)
      );
  end if;
end $$;
