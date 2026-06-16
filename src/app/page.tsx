import Link from "next/link";
import { redirect } from "next/navigation";
import { Check } from "lucide-react";
import { getSessionUserId } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

const FEATURES = [
  "Legendas geradas por IA",
  "Hashtags otimizadas automaticamente",
  "Agendamento inteligente",
  "Reels, Feed e Carrosséis",
  "API Oficial da Meta",
] as const;

export default async function HomePage() {
  const userId = await getSessionUserId();
  if (userId) redirect("/dashboard");

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col items-center justify-center px-4 text-center">
      <p className="mb-4 text-sm font-semibold uppercase tracking-[0.2em] text-ig-primary">
        🚀 Automação para Instagram
      </p>

      <h1 className="mb-6 text-4xl font-bold text-ig-text sm:text-5xl">
        Envie até 300 vídeos
        <br />
        <span className="ig-brand-gradient">uma única vez.</span>
      </h1>

      <p className="mb-8 max-w-2xl text-lg text-ig-muted">
        A IA cria legendas, gera hashtags e agenda suas publicações automaticamente para que sua
        página continue crescendo todos os dias.
      </p>

      <ul className="mb-8 grid max-w-md gap-2 text-left sm:grid-cols-2 sm:gap-x-6">
        {FEATURES.map((feature) => (
          <li key={feature} className="flex items-center gap-2 text-sm text-ig-text">
            <Check size={16} className="shrink-0 text-ig-primary" />
            {feature}
          </li>
        ))}
      </ul>

      <p className="mb-10 max-w-2xl text-ig-muted">
        Pare de perder horas postando manualmente.
        <br />
        Suba seu conteúdo hoje e deixe a plataforma trabalhar por você.
      </p>

      <div className="flex gap-4">
        <Link href="/login" className="ig-btn px-6 py-3">
          Começar Grátis
        </Link>
        <Link
          href="/login"
          className="rounded-lg border border-ig-border px-6 py-3 text-ig-text transition hover:bg-ig-secondary"
        >
          Entrar
        </Link>
      </div>
    </main>
  );
}
