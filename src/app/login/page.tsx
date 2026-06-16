import Link from "next/link";
import { redirect } from "next/navigation";
import { BrandLogo } from "@/components/BrandLogo";
import { APP_TAGLINE } from "@/lib/brand";
import { getSessionUserId } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const userId = await getSessionUserId();
  const params = await searchParams;
  const nextPath =
    params.next && params.next.startsWith("/") && !params.next.startsWith("//")
      ? params.next
      : "/dashboard";

  if (userId) redirect(nextPath);

  const errorMessages: Record<string, string> = {
    oauth_invalid: "Falha na autenticação. Tente novamente.",
    session_required: "Faça login para continuar.",
    no_instagram:
      "Nenhuma conta Instagram Business/Creator vinculada a uma Página do Facebook.",
  };

  const instagramHref = `/api/auth/meta?next=${encodeURIComponent(nextPath)}`;
  const facebookHref = `/api/auth/facebook?next=${encodeURIComponent(nextPath)}&add_account=1`;
  const tiktokHref = `/api/auth/tiktok?next=${encodeURIComponent(nextPath)}`;

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col items-center justify-center px-4">
      <div className="ig-card w-full p-8">
        <h1 className="mb-3 text-center">
          <BrandLogo className="ig-brand-script text-4xl leading-none text-ig-text" />
        </h1>
        <p className="mb-8 text-center text-sm font-semibold text-ig-primary">{APP_TAGLINE}</p>
        <p className="mb-8 text-center text-sm text-ig-muted">
          Conecte Instagram Business/Creator diretamente ou sua conta TikTok.
          Instagram direto funciona para contas Business ou Creator; use Facebook
          apenas se sua conta estiver vinculada a uma Página do Facebook.
        </p>

        {params.error && (
          <div className="ig-alert-danger mb-6 p-4 text-sm">
            {errorMessages[params.error] ?? decodeURIComponent(params.error)}
          </div>
        )}

        <a href={instagramHref} className="ig-btn w-full py-2.5">
          Conectar com Instagram
        </a>

        <a
          href={tiktokHref}
          className="mt-3 block w-full rounded-lg border border-ig-border bg-ig-elevated px-6 py-2.5 text-center text-sm font-semibold text-ig-text hover:bg-ig-secondary"
        >
          Conectar com TikTok
        </a>

        <a
          href={facebookHref}
          className="mt-3 block w-full rounded-lg bg-ig-facebook px-6 py-2.5 text-center text-sm font-semibold text-white hover:opacity-90"
        >
          Conectar via Facebook
        </a>
        <p className="mt-2 text-center text-xs text-ig-muted">
          Facebook: requer conta Instagram vinculada a uma Página do Facebook (Business).
        </p>

        <p className="mt-6 text-center text-xs text-ig-muted">
          Requer conta Instagram Business/Creator ou TikTok.
        </p>

        <footer className="mt-8 flex justify-center gap-4 text-xs text-ig-muted">
          <Link href="/privacy" className="hover:text-ig-text hover:underline">
            Privacidade
          </Link>
          <Link href="/terms" className="hover:text-ig-text hover:underline">
            Termos
          </Link>
        </footer>
      </div>
    </main>
  );
}
