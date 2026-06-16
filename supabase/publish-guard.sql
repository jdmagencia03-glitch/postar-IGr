-- Proteção extra contra republicação duplicada
-- Execute no SQL Editor do Supabase (opcional, reforço no banco)

create index if not exists idx_scheduled_posts_pending_no_media
  on scheduled_posts(scheduled_at)
  where status = 'pending' and media_id is null;

create index if not exists idx_publish_logs_post_success
  on publish_logs(post_id)
  where level = 'success';

-- Posts com media_id nunca devem voltar para pending (aplicado no app; índice auxilia consultas)
create index if not exists idx_scheduled_posts_media_id
  on scheduled_posts(media_id)
  where media_id is not null;
