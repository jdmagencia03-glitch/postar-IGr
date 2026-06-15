import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUserId } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const userId = await getSessionUserId();
  if (userId) redirect("/dashboard");

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col items-center justify-center px-4 text-center">
      <p className="mb-4 text-sm uppercase tracking-[0.2em] text-pink-400">
        API oficial da Meta
      </p>
      <h1 className="mb-6 text-4xl font-bold text-white sm:text-5xl">
        Planeje. Prepare.
        <br />
        <span className="bg-gradient-to-r from-pink-400 to-purple-400 bg-clip-text text-transparent">
          Publique em ponto.
        </span>
      </h1>
      <p className="mb-10 max-w-2xl text-zinc-400">
        Agende Reels, Feed e Carrosséis no Instagram. Gratuito com Vercel + Supabase.
        Sem assinatura mensal.
      </p>
      <div className="flex gap-4">
        <Link
          href="/login"
          className="rounded-lg bg-gradient-to-r from-pink-500 to-purple-600 px-6 py-3 font-medium text-white"
        >
          Começar grátis
        </Link>
        <Link
          href="/login"
          className="rounded-lg border border-white/20 px-6 py-3 text-zinc-300"
        >
          Entrar
        </Link>
      </div>
    </main>
  );
}
