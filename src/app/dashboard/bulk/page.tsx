import { redirect } from "next/navigation";
import { Navbar } from "@/components/Navbar";
import { BulkUploadForm } from "@/components/BulkUploadForm";
import { getOwnerAccounts } from "@/lib/accounts";
import { getPlaybookForOwner, playbookHasContent } from "@/lib/ai/playbook";
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
  const playbook = await getPlaybookForOwner(ownerId);
  const playbookReady = playbookHasContent(playbook);
  const defaultAccountId =
    params.account && accounts.some((a) => a.id === params.account)
      ? params.account
      : accounts[0]?.id;

  if (!accounts.length) {
    return (
      <div>
        <Navbar />
        <main className="mx-auto max-w-2xl px-4 py-8 text-center text-zinc-400">
          <p className="mb-4">Conecte uma conta Instagram primeiro.</p>
          <a href="/api/auth/meta?next=/dashboard/bulk" className="text-pink-400 hover:underline">
            Conectar conta
          </a>
        </main>
      </div>
    );
  }

  return (
    <div>
      <Navbar />
      <main className="mx-auto max-w-2xl px-4 py-8">
        <h1 className="mb-2 text-2xl font-bold text-white">Programar conteúdo</h1>
        <p className="mb-8 text-zinc-400">
          Experiência hands-off: envie os vídeos prontos e a IA define legendas, hashtags e
          distribuição em semanas ou meses.
        </p>
        {accounts.length > 1 && (
          <p className="mb-8 text-sm text-zinc-500">
            {accounts.length} contas conectadas.{" "}
            <a href="/dashboard/accounts" className="text-pink-400 hover:underline">
              Gerenciar contas
            </a>
          </p>
        )}
        {accounts.length <= 1 && (
          <p className="mb-8 text-sm text-zinc-500">
            <a href="/dashboard/accounts" className="text-pink-400 hover:underline">
              Adicionar outra conta Instagram
            </a>
          </p>
        )}
        <BulkUploadForm
          accounts={accounts as InstagramAccount[]}
          defaultAccountId={defaultAccountId}
          playbookReady={playbookReady}
        />
      </main>
    </div>
  );
}
