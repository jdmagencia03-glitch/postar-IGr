import { redirect } from "next/navigation";
import { Navbar } from "@/components/Navbar";
import { AccountsManager } from "@/components/AccountsManager";
import { isFacebookOAuthConfigured } from "@/lib/meta/facebook-oauth";
import { getSessionUserId } from "@/lib/meta/oauth";

export const dynamic = "force-dynamic";

export default async function AccountsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; connected?: string }>;
}) {
  const ownerId = await getSessionUserId();
  if (!ownerId) redirect("/login?next=/dashboard/accounts");

  const params = await searchParams;

  return (
    <div>
      <Navbar />
      <main className="mx-auto max-w-4xl px-4 py-8">
        <h1 className="mb-2 text-2xl font-bold text-white">Contas Instagram</h1>
        <p className="mb-8 text-zinc-400">
          Gerencie várias contas no mesmo painel. Use Via Facebook para adicionar contas
          automaticamente.
        </p>
        <AccountsManager
          oauthError={params.error}
          connected={params.connected}
          facebookEnabled={isFacebookOAuthConfigured()}
        />
      </main>
    </div>
  );
}
