import { redirect } from "next/navigation";
import { Navbar } from "@/components/Navbar";
import { BulkUploadForm } from "@/components/BulkUploadForm";
import { UploadGlobalBar } from "@/components/upload/UploadGlobalBar";
import { UploadProvider } from "@/contexts/UploadContext";
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
  const activeAccounts = platform === "tiktok" ? tiktokAccounts : accounts;
  const defaultAccountId =
    params.account && activeAccounts.some((a) => a.id === params.account)
      ? params.account
      : activeAccounts[0]?.id;

  if (!activeAccounts.length) {
    const connectHref =
      platform === "tiktok"
        ? "/api/auth/tiktok?next=/dashboard/bulk?platform=tiktok"
        : "/api/auth/meta?next=/dashboard/bulk";
    const label = platform === "tiktok" ? "TikTok" : "Instagram";

    return (
      <div>
        <Navbar />
        <main className="mx-auto max-w-2xl px-4 py-8 text-center text-ig-muted">
          <p className="mb-4">Conecte uma conta {label} primeiro.</p>
          <a href={connectHref} className="text-ig-primary hover:underline">
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
              {platform === "tiktok"
                ? "🎵 Envie vídeos para o TikTok de uma vez"
                : "🚀 Envie todo o seu conteúdo de uma vez"}
            </h1>
            <p className="mx-auto mt-3 max-w-2xl text-ig-muted">
              {platform === "tiktok"
                ? "A plataforma envia, organiza, cria legendas e agenda automaticamente seus vídeos no TikTok."
                : "A plataforma envia, organiza, cria legendas e agenda automaticamente seus vídeos para manter sua página ativa por semanas ou meses."}
            </p>
          </header>

          <BulkUploadForm
            platform={platform}
            accounts={accounts as InstagramAccount[]}
            tiktokAccounts={tiktokAccounts}
            defaultAccountId={defaultAccountId}
          />
        </main>
        <UploadGlobalBar />
      </div>
    </UploadProvider>
  );
}
