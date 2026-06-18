import { redirect } from "next/navigation";
import { CampaignsManager } from "@/components/campaigns/CampaignsManager";
import { getOwnerAccountRefs } from "@/lib/posts";
import { getSessionUserId } from "@/lib/meta/oauth";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export default async function CampaignsPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string; product?: string }>;
}) {
  const ownerId = await getSessionUserId();
  if (!ownerId) redirect("/login?next=/dashboard/campaigns");

  const params = await searchParams;
  const supabase = createAdminClient();
  const accountRefs = await getOwnerAccountRefs(supabase, ownerId);

  const accountOptions = accountRefs.map((account) => ({
    id: account.id,
    platform: account.platform,
    label: `${account.platform === "tiktok" ? "TT" : "IG"} @${account.username ?? "conta"}`,
  }));

  return (
    <>
      <header className="ig-page-header">
        <h1>Campanhas</h1>
        <p>Operações de venda e crescimento usando suas páginas.</p>
      </header>
      <CampaignsManager
        initialId={params.id}
        productFilter={params.product}
        accountOptions={accountOptions}
      />
    </>
  );
}
