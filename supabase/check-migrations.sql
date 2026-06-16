-- Verifica quais migrações SQL do PostarIG já foram aplicadas
-- Cole TUDO no SQL Editor do Supabase e clique Run (uma única query)
-- applied = true  → já rodou
-- applied = false → ainda falta rodar

with checks as (
  select * from (values
    ('schema.sql', 'extensão pgcrypto', exists(
      select 1 from pg_extension where extname = 'pgcrypto'
    )),
    ('schema.sql', 'tabela oauth_states', exists(
      select 1 from information_schema.tables
      where table_schema = 'public' and table_name = 'oauth_states'
    )),
    ('schema.sql', 'tabela app_sessions', exists(
      select 1 from information_schema.tables
      where table_schema = 'public' and table_name = 'app_sessions'
    )),
    ('schema.sql', 'tabela instagram_accounts', exists(
      select 1 from information_schema.tables
      where table_schema = 'public' and table_name = 'instagram_accounts'
    )),
    ('schema.sql', 'tabela scheduled_posts', exists(
      select 1 from information_schema.tables
      where table_schema = 'public' and table_name = 'scheduled_posts'
    )),
    ('schema.sql', 'tabela publish_logs', exists(
      select 1 from information_schema.tables
      where table_schema = 'public' and table_name = 'publish_logs'
    )),
    ('schema.sql', 'tabela ai_playbooks', exists(
      select 1 from information_schema.tables
      where table_schema = 'public' and table_name = 'ai_playbooks'
    )),
    ('schema.sql', 'tabela account_metrics_snapshots', exists(
      select 1 from information_schema.tables
      where table_schema = 'public' and table_name = 'account_metrics_snapshots'
    )),
    ('schema.sql', 'bucket storage media', exists(
      select 1 from storage.buckets where id = 'media'
    )),
    ('schema.sql', 'bucket media limite 500MB', exists(
      select 1 from storage.buckets
      where id = 'media' and file_size_limit >= 524288000
    )),
    ('multi-account.sql', 'coluna instagram_accounts.owner_id', exists(
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = 'instagram_accounts'
        and column_name = 'owner_id'
    )),
    ('auth-provider.sql', 'coluna instagram_accounts.auth_provider', exists(
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = 'instagram_accounts'
        and column_name = 'auth_provider'
    )),
    ('account-warmup.sql', 'coluna instagram_accounts.warmup_enabled', exists(
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = 'instagram_accounts'
        and column_name = 'warmup_enabled'
    )),
    ('account-warmup.sql', 'coluna instagram_accounts.warmup_days', exists(
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = 'instagram_accounts'
        and column_name = 'warmup_days'
    )),
    ('account-warmup.sql', 'coluna instagram_accounts.warmup_started_at', exists(
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = 'instagram_accounts'
        and column_name = 'warmup_started_at'
    )),
    ('post-actions.sql', 'coluna scheduled_posts.hidden_from_report', exists(
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = 'scheduled_posts'
        and column_name = 'hidden_from_report'
    )),
    ('upload-batches.sql', 'tabela upload_batches', exists(
      select 1 from information_schema.tables
      where table_schema = 'public' and table_name = 'upload_batches'
    )),
    ('upload-batches.sql', 'tabela upload_files', exists(
      select 1 from information_schema.tables
      where table_schema = 'public' and table_name = 'upload_files'
    )),
    ('upload-batches.sql', 'coluna upload_batches.schedule_mode', exists(
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = 'upload_batches'
        and column_name = 'schedule_mode'
    )),
    ('upload-batches.sql', 'coluna upload_batches.custom_schedule', exists(
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = 'upload_batches'
        and column_name = 'custom_schedule'
    )),
    ('upload-supreme.sql', 'coluna upload_batches.paused', exists(
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = 'upload_batches'
        and column_name = 'paused'
    )),
    ('upload-supreme.sql', 'coluna upload_batches.upload_speed_mode', exists(
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = 'upload_batches'
        and column_name = 'upload_speed_mode'
    )),
    ('upload-supreme.sql', 'coluna upload_files.file_hash', exists(
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = 'upload_files'
        and column_name = 'file_hash'
    )),
    ('upload-supreme.sql', 'coluna upload_files.removed', exists(
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = 'upload_files'
        and column_name = 'removed'
    )),
    ('security.sql', 'tabela security_audit_logs', exists(
      select 1 from information_schema.tables
      where table_schema = 'public' and table_name = 'security_audit_logs'
    )),
    ('security.sql', 'RLS instagram_accounts', exists(
      select 1 from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = 'instagram_accounts'
        and c.relrowsecurity = true
    )),
    ('security.sql', 'RLS scheduled_posts', exists(
      select 1 from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = 'scheduled_posts'
        and c.relrowsecurity = true
    )),
    ('security.sql', 'RLS upload_batches', exists(
      select 1 from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = 'upload_batches'
        and c.relrowsecurity = true
    )),
    ('security.sql', 'RLS upload_files', exists(
      select 1 from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = 'upload_files'
        and c.relrowsecurity = true
    )),
    ('security.sql', 'RLS security_audit_logs', exists(
      select 1 from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = 'security_audit_logs'
        and c.relrowsecurity = true
    ))
  ) as t(script_file, check_name, ok)
),
detail as (
  select
    'DETALHE'::text as tipo,
    script_file,
    check_name,
    ok as applied,
    null::boolean as all_true,
    null::bigint as ok_count,
    null::bigint as total_checks
  from checks
),
summary as (
  select
    'RESUMO'::text as tipo,
    script_file,
    null::text as check_name,
    null::boolean as applied,
    bool_and(ok) as all_true,
    count(*) filter (where ok) as ok_count,
    count(*) as total_checks
  from checks
  group by script_file
)
select * from detail
union all
select * from summary
order by
  tipo desc,
  script_file,
  check_name nulls last;
