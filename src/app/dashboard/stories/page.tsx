import { redirect } from "next/navigation";
import { ScheduleStoriesForm } from "@/components/stories/ScheduleStoriesForm";
import { getOwnerAccounts } from "@/lib/accounts";
import { getSessionUserId } from "@/lib/meta/oauth";
import { createAdminClient } from "@/lib/supabase/admin";
import type { InstagramAccount } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function StoriesPage({
  searchParams,
}: {
  searchParams: Promise<{ account?: string }>;
}) {
  const ownerId = await getSessionUserId();
  if (!ownerId) redirect("/login?next=/dashboard/stories");

  const params = await searchParams;
  const supabase = createAdminClient();
  const accounts = await getOwnerAccounts(supabase, ownerId);
  const defaultAccountId =
    params.account && accounts.some((account) => account.id === params.account)
      ? params.account
      : accounts[0]?.id;

  if (!accounts.length) {
    return (
      <div className="mx-auto max-w-lg py-12 text-center text-ig-muted">
        <p className="mb-4">Conecte uma conta Instagram primeiro.</p>
        <a href="/api/auth/meta?next=/dashboard/stories" className="ig-btn px-5 py-2.5">
          Conectar conta
        </a>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl pb-8">
      <header className="ig-page-header">
        <h1>Programar Stories</h1>
        <p>
          Agende stories com objetivo, CTA e horários. A IA gera os textos usando o playbook da conta
          selecionada.
        </p>
      </header>

      <ScheduleStoriesForm
        accounts={accounts as InstagramAccount[]}
        defaultAccountId={defaultAccountId}
      />
    </div>
  );
}
