import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUserId } from "@/lib/meta/oauth";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const userId = await getSessionUserId();
  if (userId) redirect("/dashboard");

  const params = await searchParams;
  const errorMessages: Record<string, string> = {
    oauth_invalid: "Falha na autenticação. Tente novamente.",
    no_instagram:
      "Nenhuma conta Instagram Business/Creator vinculada a uma Página do Facebook.",
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-4">
      <h1 className="mb-2 text-2xl font-bold text-white">Entrar</h1>
      <p className="mb-8 text-center text-sm text-zinc-400">
        Conecte sua conta Instagram Business ou Creator diretamente.
        Não precisa de Página do Facebook.
      </p>

      {params.error && (
        <div className="mb-6 w-full rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
          {errorMessages[params.error] ?? decodeURIComponent(params.error)}
        </div>
      )}

      <Link
        href="/api/auth/meta"
        className="w-full rounded-lg bg-gradient-to-r from-pink-500 to-purple-600 px-6 py-3 text-center font-medium text-white"
      >
        Conectar com Instagram
      </Link>

      <p className="mt-6 text-center text-xs text-zinc-500">
        Requer conta Instagram Business ou Creator.
      </p>
    </main>
  );
}
