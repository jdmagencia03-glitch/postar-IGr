-- Impede dois posts ativos no mesmo horário por conta/plataforma.
-- Rode no SQL Editor do Supabase.

create unique index if not exists unique_active_scheduled_slot
on scheduled_posts (
  coalesce(account_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(tiktok_account_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(platform, 'instagram'),
  scheduled_at
)
where status in ('pending', 'processing', 'retrying');
