# JDM Hub

Agendador multi-plataforma (Instagram e TikTok) com **APIs oficiais**, hospedado em **Vercel** com banco **Supabase**.

## Stack

- Next.js 16 + TypeScript + Tailwind
- Supabase (PostgreSQL + Storage)
- Vercel (deploy)
- cron-job.org (cron gratuito a cada minuto)

## Setup local

```bash
cp .env.local.example .env.local
npm install
npm run dev
```

## 1. Supabase (gratuito ou Pro)

1. Crie projeto em https://supabase.com
2. SQL Editor → execute `supabase/schema.sql`
3. **Pro:** execute também `supabase/storage-pro.sql` (limite 1GB/arquivo + índices)
4. Storage → crie bucket `media` → marque como **público** (se ainda não existir)
5. Copie URL, anon key e service role key para `.env.local`
6. **Pro:** configure `SUPABASE_PLAN=pro` e `NEXT_PUBLIC_SUPABASE_PLAN=pro` na Vercel

## 2. Meta Developer

1. Crie app em https://developers.facebook.com
2. Adicione produto **Instagram Graph API**
3. OAuth Redirect: `http://localhost:3000/api/auth/meta/callback`
4. Permissões: `instagram_business_basic`, `instagram_business_content_publish`, `pages_show_list`, `pages_read_engagement`
5. Conta Instagram **Business/Creator** vinculada a Página do Facebook

## 3. Deploy Vercel + GitHub

1. Suba o repo no GitHub
2. Importe no https://vercel.com
3. Configure as variáveis de ambiente (todas do `.env.local.example`)
4. Atualize `META_REDIRECT_URI` e `NEXT_PUBLIC_APP_URL` para sua URL da Vercel

## 4. Cron gratuito (publicação automática)

O Vercel gratuito só permite cron 1x/dia. Use **cron-job.org** (grátis):

- URL: `https://SEU-DOMINIO.vercel.app/api/cron/publish`
- Método: GET
- Intervalo: a cada **1 minuto**
- Header: `Authorization: Bearer SEU_CRON_SECRET`

O cron também **apaga vídeos do Supabase Storage 2 horas após publicar** (economiza storage). Execute `supabase/media-cleanup.sql` no SQL Editor.

## Custo total

| Serviço | Custo |
|---------|-------|
| Vercel | R$ 0 |
| Supabase | R$ 0 (free) ou Pro (100GB+) |
| cron-job.org | R$ 0 |
| OpenAI (legendas, opcional) | ~R$ 0–30/mês |

## Funcionalidades

- Login via Meta OAuth
- Agendamento individual e em massa
- Reels, Feed e Carrossel
- Calendário de posts
- Logs de publicação
- Legendas com IA (opcional)
