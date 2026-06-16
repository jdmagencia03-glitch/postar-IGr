-- Posts agendados multi-plataforma (Instagram + TikTok)
-- Execute no SQL Editor do Supabase

alter table scheduled_posts
  add column if not exists platform text not null default 'instagram'
    check (platform in ('instagram', 'tiktok'));

alter table scheduled_posts
  add column if not exists tiktok_account_id uuid references tiktok_accounts(id) on delete cascade;

alter table scheduled_posts
  alter column account_id drop not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'scheduled_posts_platform_account_check'
  ) then
    alter table scheduled_posts
      add constraint scheduled_posts_platform_account_check check (
        (platform = 'instagram' and account_id is not null and tiktok_account_id is null)
        or (platform = 'tiktok' and tiktok_account_id is not null)
      );
  end if;
end $$;

create index if not exists idx_scheduled_posts_tiktok_account
  on scheduled_posts(tiktok_account_id);

create index if not exists idx_scheduled_posts_platform
  on scheduled_posts(platform, status, scheduled_at);
