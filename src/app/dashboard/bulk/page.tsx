import { redirect } from "next/navigation";
import { Navbar } from "@/components/Navbar";
import { BulkUploadForm } from "@/components/BulkUploadForm";
import { UploadGlobalBar } from "@/components/upload/UploadGlobalBar";
import { UploadProvider } from "@/contexts/UploadContext";
import { getOwnerAccounts } from "@/lib/accounts";
import { getSessionUserId } from "@/lib/meta/oauth";
import { createAdminClient } from "@/lib/supabase/admin";
import type { InstagramAccount } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function BulkPage({
  searchParams,
}: {
  searchParams: Promise<{ account?: string }>;
}) {
  const ownerId = await getSessionUserId();
  if (!ownerId) redirect("/login?next=/dashboard/bulk");

  const params = await searchParams;
  const supabase = createAdminClient();
  const accounts = await getOwnerAccounts(supabase, ownerId);
  const defaultAccountId =
    params.account && accounts.some((a) => a.id === params.account)
      ? params.account
      : accounts[0]?.id;

  if (!accounts.length) {
    return (
      <div>
        <Navbar />
        <main className="mx-auto max-w-2xl px-4 py-8 text-center text-ig-muted">
          <p className="mb-4">Conecte uma conta Instagram primeiro.</p>
          <a href="/api/auth/meta?next=/dashboard/bulk" className="text-ig-primary hover:underline">
            Conectar conta
          </a>
        </main>
      </div>
    );
  }

  return (
    <UploadProvider>
      <div>
        <Navbar />
        <main className="mx-auto max-w-3xl px-4 py-8 pb-24">
          <header className="mb-8 text-center">
            <h1 className="text-2xl font-bold text-ig-text sm:text-3xl">
              🚀 Envie todo o seu conteúdo de uma vez
            </h1>
            <p className="mx-auto mt-3 max-w-2xl text-ig-muted">
              A plataforma envia, organiza, cria legendas e agenda automaticamente seus vídeos para manter sua página ativa por semanas ou meses.
            </p>
          </header>

          <BulkUploadForm
            accounts={accounts as InstagramAccount[]}
            defaultAccountId={defaultAccountId}
          />
        </main>
        <UploadGlobalBar />
      </div>
    </UploadProvider>
  );
}
