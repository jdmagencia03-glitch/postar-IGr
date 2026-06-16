-- Ações em posts agendados (ocultar do relatório)
-- Execute no SQL Editor do Supabase

alter table scheduled_posts
  add column if not exists hidden_from_report boolean not null default false;

create index if not exists idx_scheduled_posts_hidden
  on scheduled_posts(hidden_from_report);
