import { redirect } from "next/navigation";
import { BulkUploadForm } from "@/components/BulkUploadForm";
import { getOwnerAccounts } from "@/lib/accounts";
import { getOwnerTikTokAccounts } from "@/lib/tiktok/accounts";
import { getSessionUserId } from "@/lib/meta/oauth";
import { createAdminClient } from "@/lib/supabase/admin";
import type { InstagramAccount, SocialPlatform } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function BulkPage({
  searchParams,
}: {
  searchParams: Promise<{ account?: string; platform?: string }>;
}) {
  const ownerId = await getSessionUserId();
  if (!ownerId) redirect("/login?next=/dashboard/bulk");

  const params = await searchParams;
  const platform: SocialPlatform = params.platform === "tiktok" ? "tiktok" : "instagram";
  const supabase = createAdminClient();
  const accounts = await getOwnerAccounts(supabase, ownerId);
  const tiktokAccounts = await getOwnerTikTokAccounts(supabase, ownerId);

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
          horários para cada plataforma.
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
}
