import { redirect } from "next/navigation";
import { Navbar } from "@/components/Navbar";
import { AccountsManager } from "@/components/AccountsManager";
import { TikTokAccountsSection } from "@/components/TikTokAccountsSection";
import { isFacebookOAuthConfigured } from "@/lib/meta/facebook-oauth";
import { isTikTokOAuthConfigured } from "@/lib/tiktok/oauth";
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
        <h1 className="mb-2 text-2xl font-bold text-ig-text">Contas conectadas</h1>
        <p className="mb-8 text-ig-muted">
          Gerencie contas Instagram e TikTok no mesmo painel.
        </p>
        <AccountsManager
          oauthError={params.error}
          connected={params.connected}
          facebookEnabled={isFacebookOAuthConfigured()}
        />

        <section className="ig-panel mt-8 p-5">
          <h2 className="mb-4 text-lg font-semibold text-ig-text">Contas TikTok</h2>
          {!isTikTokOAuthConfigured() && (
            <p className="mb-4 text-sm text-ig-muted">
              Configure TIKTOK_CLIENT_KEY e TIKTOK_CLIENT_SECRET na Vercel para habilitar OAuth.
            </p>
          )}
          <TikTokAccountsSection connectHref="/api/auth/tiktok?next=/dashboard/accounts&add_account=1" compact />
        </section>
      </main>
    </div>
  );
}
