import { redirect } from "next/navigation";
import { BulkUploadForm } from "@/components/BulkUploadForm";
import { getOwnerAccounts } from "@/lib/accounts";
import { getOwnerTikTokAccounts } from "@/lib/tiktok/accounts";
import { getSessionUserId } from "@/lib/meta/oauth";
import { createAdminClient } from "@/lib/supabase/admin";
import type { InstagramAccount, SocialPlatform } from "@/lib/types";
import { withTimeoutOrNull } from "@/lib/with-timeout";

export const dynamic = "force-dynamic";
const BULK_LOAD_TIMEOUT_MS = 8_000;

export default async function BulkPage({
  searchParams,
}: {
  searchParams: Promise<{ account?: string; platform?: string }>;
}) {
  try {
    const ownerId = await getSessionUserId();
    if (!ownerId) redirect("/login?next=/dashboard/bulk");

    const params = await searchParams;
    const platform: SocialPlatform = params.platform === "tiktok" ? "tiktok" : "instagram";
    const supabase = createAdminClient();
    const [accounts, tiktokAccounts] = await Promise.all([
      withTimeoutOrNull(
        getOwnerAccounts(supabase, ownerId),
        BULK_LOAD_TIMEOUT_MS,
        "dashboard-bulk-accounts",
      ),
      withTimeoutOrNull(
        getOwnerTikTokAccounts(supabase, ownerId),
        BULK_LOAD_TIMEOUT_MS,
        "dashboard-bulk-tiktok-accounts",
      ),
    ]);

    if (!accounts || !tiktokAccounts) {
      return (
        <div className="mx-auto max-w-lg py-12 text-center">
          <h2 className="text-lg font-semibold text-ig-text">Banco temporariamente lento</h2>
          <p className="mt-2 text-sm text-ig-muted">
            Não foi possível carregar as contas agora. Tente novamente em alguns segundos.
          </p>
          <div className="mt-4 flex justify-center gap-2">
            <a href="/dashboard/bulk" className="ig-btn px-4 py-2 text-sm">
              Tentar novamente
            </a>
            <a href="/dashboard" className="ig-btn-secondary px-4 py-2 text-sm">
              Ir ao início
            </a>
          </div>
        </div>
      );
    }

    if (!accounts.length && !tiktokAccounts.length) {
      return (
        <div className="mx-auto max-w-lg py-12 text-center text-ig-muted">
          <p className="mb-4">Conecte uma conta Instagram ou TikTok primeiro.</p>
          <div className="flex flex-wrap justify-center gap-3">
            <a href="/api/auth/meta?next=/dashboard/bulk" className="ig-btn px-5 py-2.5">
              Conectar Instagram
            </a>
            <a
              href="/api/auth/tiktok?next=/dashboard/bulk?platform=tiktok&add_account=1"
              className="ig-btn-secondary px-5 py-2.5"
            >
              Conectar TikTok
            </a>
          </div>
        </div>
      );
    }

    const activeAccounts = platform === "tiktok" ? tiktokAccounts : accounts;
    const defaultAccountId =
      params.account && activeAccounts.some((a) => a.id === params.account)
        ? params.account
        : activeAccounts[0]?.id;

    return (
      <div className="mx-auto max-w-3xl pb-8">
        <header className="ig-page-header">
          <h1>Agendar vídeos</h1>
          <p>
            Envie uma vez e publique no Instagram Reels, TikTok ou nos dois. A IA adapta legendas e
            horários para cada plataforma. Você pode enviar até 600 vídeos por lote. Lotes grandes
            serão processados em fila e podem levar mais tempo para concluir.
          </p>
        </header>

        <BulkUploadForm
          platform={platform}
          accounts={accounts as InstagramAccount[]}
          tiktokAccounts={tiktokAccounts}
          defaultAccountId={defaultAccountId}
        />
      </div>
    );
  } catch (error) {
    console.error("[bulk-page-failed]", error);
    return (
      <div className="mx-auto max-w-lg py-12 text-center">
        <h2 className="text-lg font-semibold text-ig-text">Servidor instável no momento</h2>
        <p className="mt-2 text-sm text-ig-muted">
          Sua conexão oscilou durante o envio. Vamos tentar novamente automaticamente.
        </p>
        <div className="mt-4 flex justify-center gap-2">
          <a href="/dashboard/bulk" className="ig-btn px-4 py-2 text-sm">
            Tentar novamente
          </a>
          <a href="/dashboard" className="ig-btn-secondary px-4 py-2 text-sm">
            Ir ao início
          </a>
        </div>
      </div>
    );
  }
}
