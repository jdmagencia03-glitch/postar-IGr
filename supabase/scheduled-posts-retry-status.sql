-- Estende scheduled_posts.status (retrying, failed_persistent, cancelled).
--
-- ATENÇÃO: rode fora do horário de pico ou com cron de publicação pausado.
-- O DROP/ADD antigo travava a tabela inteira. Este script usa NOT VALID (menos lock).
--
-- Se travar: rode supabase/unblock-stuck-queries.sql e cancele o pid preso.

-- Passo A — adiciona constraint nova sem revalidar tudo de uma vez
alter table scheduled_posts
  drop constraint if exists scheduled_posts_status_check_v2;

alter table scheduled_posts
  add constraint scheduled_posts_status_check_v2
  check (status in (
    'pending',
    'processing',
    'published',
    'failed',
    'retrying',
    'failed_persistent',
    'cancelled'
  )) not valid;

-- Passo B — valida linhas existentes (pode levar alguns segundos)
alter table scheduled_posts
  validate constraint scheduled_posts_status_check_v2;

-- Passo C — remove a constraint antiga e renomeia
alter table scheduled_posts
  drop constraint if exists scheduled_posts_status_check;

alter table scheduled_posts
  rename constraint scheduled_posts_status_check_v2 to scheduled_posts_status_check;
