import Link from "next/link";
import { redirect } from "next/navigation";
import { Check } from "lucide-react";
import { BrandLogo } from "@/components/BrandLogo";
import { APP_TAGLINE } from "@/lib/brand";
import { getSessionUserId } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

const FEATURES = [
  "Legendas geradas por IA",
  "Hashtags otimizadas automaticamente",
  "Agendamento inteligente",
  "Instagram, TikTok e mais em um só lugar",
  "APIs oficiais Meta e TikTok",
] as const;

export default async function HomePage() {
  const userId = await getSessionUserId();
  if (userId) redirect("/dashboard");

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col items-center justify-center px-4 text-center">
      <div className="mb-6">
        <BrandLogo className="ig-brand-script text-5xl leading-none text-ig-text sm:text-6xl" />
      </div>

      <h1 className="mb-6 max-w-2xl text-3xl font-bold leading-tight text-ig-text sm:text-4xl">
        <span className="ig-brand-gradient">{APP_TAGLINE}</span>
      </h1>

      <p className="mb-8 max-w-2xl text-lg text-ig-muted">
        Envie centenas de vídeos de uma vez. A IA cria legendas, define horários e publica no
        Instagram e TikTok enquanto você foca em crescer.
      </p>

      <ul className="mb-8 grid max-w-md gap-2 text-left sm:grid-cols-2 sm:gap-x-6">
        {FEATURES.map((feature) => (
          <li key={feature} className="flex items-center gap-2 text-sm text-ig-text">
            <Check size={16} className="shrink-0 text-ig-primary" />
            {feature}
          </li>
        ))}
      </ul>

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

      <footer className="mt-16 flex gap-4 text-xs text-ig-muted">
        <Link href="/privacy" className="hover:text-ig-text hover:underline">
          Privacidade
        </Link>
        <Link href="/terms" className="hover:text-ig-text hover:underline">
          Termos
        </Link>
      </footer>
    </main>
  );
}
