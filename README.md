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

## 1. Supabase (gratuito)

1. Crie projeto em https://supabase.com
2. SQL Editor → execute `supabase/schema.sql`
3. Storage → crie bucket `media` → marque como **público**
4. Copie URL, anon key e service role key para `.env.local`

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

## Custo total

| Serviço | Custo |
|---------|-------|
| Vercel | R$ 0 |
| Supabase | R$ 0 (até 500MB DB + 1GB storage) |
| cron-job.org | R$ 0 |
| OpenAI (legendas, opcional) | ~R$ 0–30/mês |

## Funcionalidades

- Login via Meta OAuth
- Agendamento individual e em massa
- Reels, Feed e Carrossel
- Calendário de posts
- Logs de publicação
- Legendas com IA (opcional)
