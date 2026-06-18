-- Execute no SQL Editor do Supabase para habilitar o treinamento da IA
-- https://supabase.com/dashboard

create table if not exists ai_playbooks (
  owner_id text primary key,
  brand_name text,
  niche text,
  target_audience text,
  tone_voice text,
  viral_hooks text,
  hashtag_strategy text,
  cta_style text,
  example_captions text,
  avoid_rules text,
  extra_knowledge text,
  playbooks_by_account jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
