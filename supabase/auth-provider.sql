-- Adiciona provedor de autenticação (instagram direto ou via Facebook)
alter table instagram_accounts
  add column if not exists auth_provider text not null default 'instagram';
