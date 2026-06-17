import { redirect } from "next/navigation";
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
      <div className="mx-auto max-w-lg py-12 text-center text-ig-muted">
        <p className="mb-4">Conecte uma conta {label} primeiro.</p>
        <a href={connectHref} className="ig-btn px-5 py-2.5">
          Conectar conta
        </a>
      </div>
    );
  }

  return (
    <UploadProvider>
      <div className="mx-auto max-w-3xl pb-24">
        <header className="ig-page-header">
          <h1>{platform === "tiktok" ? "Agendar no TikTok" : "Agendar posts"}</h1>
          <p>
            {platform === "tiktok"
              ? "Envie vários vídeos de uma vez. A IA cria legendas e agenda automaticamente."
              : "Envie vários vídeos de uma vez. A IA cria legendas e agenda automaticamente."}
          </p>
        </header>

        <BulkUploadForm
          platform={platform}
          accounts={accounts as InstagramAccount[]}
          tiktokAccounts={tiktokAccounts}
          defaultAccountId={defaultAccountId}
        />
      </div>
      <UploadGlobalBar />
    </UploadProvider>
  );
}
