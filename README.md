# JDM Hub

Agendador multi-plataforma (Instagram e TikTok) com **APIs oficiais**, hospedado em **Vercel** com banco **Supabase**.

## Stack

- Next.js 16 + TypeScript + Tailwind
- Supabase (PostgreSQL + Auth)
- Bunny.net (Storage de vídeos via CDN)
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
4. Storage → bucket `media` **só é necessário** se `MEDIA_STORAGE_PROVIDER=supabase` (legado). Com Bunny, o Postgres continua no Supabase; vídeos vão para o CDN.
5. Copie URL, anon key e service role key para `.env.local`
6. **Pro:** configure `SUPABASE_PLAN=pro` e `NEXT_PUBLIC_SUPABASE_PLAN=pro` na Vercel

## 1b. Bunny.net Stream (vídeos — recomendado)

Biblioteca **JDM HUB** usa [Bunny Stream](https://docs.bunny.net/api-reference/stream) com upload **TUS resumível** (ideal para vídeos grandes).

1. Painel Bunny → **Stream** → sua biblioteca → **API**
2. Copie **Video library ID**, **API Key** e **CDN hostname**
3. Variáveis na Vercel / `.env.local`:

```env
MEDIA_STORAGE_PROVIDER=bunny
BUNNY_MEDIA_BACKEND=stream
BUNNY_STREAM_LIBRARY_ID=689933
BUNNY_STREAM_API_KEY=sua-api-key-da-biblioteca
BUNNY_STREAM_CDN_HOSTNAME=vz-3b70f876-76d.b-cdn.net
```

4. **Segurança:** a API key fica só no servidor; o navegador recebe assinatura TUS temporária (válida 24h)
5. URLs públicas para o Instagram: `https://{CDN}/{videoId}/original`
6. Documentação: [Stream API](https://docs.bunny.net/api-reference/stream) · [TUS uploads](https://docs.bunny.net/stream/tus-resumable-uploads)

### Alternativa: Bunny Storage (sem transcoding Stream)

Se preferir arquivos MP4 brutos em Storage Zone, use `BUNNY_MEDIA_BACKEND=storage` e as variáveis `BUNNY_STORAGE_*` (ver `.env.local.example`).

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

O cron também **apaga vídeos do storage (Bunny CDN) 2 horas após publicar**. Execute `supabase/media-cleanup.sql` no SQL Editor.

## Custo total

| Serviço | Custo |
|---------|-------|
| Vercel | R$ 0 |
| Supabase | R$ 0 (free) ou Pro (compute + Postgres) |
| Bunny.net | ~US$ 0,01/GB storage + banda barata |
| cron-job.org | R$ 0 |
| OpenAI (legendas, opcional) | ~R$ 0–30/mês |

## Funcionalidades

- Login via Meta OAuth
- Agendamento individual e em massa
- Reels, Feed e Carrossel
- Calendário de posts
- Logs de publicação
- Legendas com IA (opcional)
