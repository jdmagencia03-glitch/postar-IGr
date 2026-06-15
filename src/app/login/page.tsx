import { redirect } from "next/navigation";
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
    no_instagram:
      "Nenhuma conta Instagram Business/Creator vinculada a uma Página do Facebook.",
  };

  const loginHref = `/api/auth/meta?next=${encodeURIComponent(nextPath)}`;
  const facebookHref = `/api/auth/facebook?next=${encodeURIComponent(nextPath)}&add_account=1`;

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col items-center justify-center px-4">
      <div className="ig-card w-full p-8">
        <h1 className="ig-brand-script mb-6 text-center text-4xl">
          <span className="ig-brand-gradient">InstaScheduler</span>
        </h1>
        <p className="mb-8 text-center text-sm text-ig-muted">
          Conecte sua conta Instagram Business ou Creator diretamente.
          Não precisa de Página do Facebook.
        </p>

        {params.error && (
          <div className="ig-alert-danger mb-6 p-4 text-sm">
            {errorMessages[params.error] ?? decodeURIComponent(params.error)}
          </div>
        )}

        <a href={loginHref} className="ig-btn w-full py-2.5">
          Conectar com Instagram
        </a>

        <a
          href={facebookHref}
          className="mt-3 block w-full rounded-lg bg-[#1877F2] px-6 py-2.5 text-center text-sm font-semibold text-ig-text hover:opacity-90"
        >
          Conectar via Facebook
        </a>

        <p className="mt-6 text-center text-xs text-ig-muted">
          Requer conta Instagram Business ou Creator.
        </p>
      </div>
    </main>
  );
}
