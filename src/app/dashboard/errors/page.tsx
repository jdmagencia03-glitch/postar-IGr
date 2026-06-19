import { redirect } from "next/navigation";
import { ErrorCenter } from "@/components/operations/ErrorCenter";
import { getSessionUserId } from "@/lib/meta/oauth";
import { listOperationalErrors } from "@/lib/operations/operational-errors";
import { getOwnerAccountRefs } from "@/lib/posts";
import { createAdminClient } from "@/lib/supabase/admin";
import type {
  OperationalErrorCategory,
  OperationalErrorSeverity,
  OperationalErrorStatus,
  SocialPlatform,
} from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function ErrorsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const ownerId = await getSessionUserId();
  if (!ownerId) redirect("/login?next=/dashboard/errors");

  const params = await searchParams;
  const platform = (params.platform as SocialPlatform | undefined) ?? "all";
  const accountRefs = await getOwnerAccountRefs(createAdminClient(), ownerId);
  const visibleRefs = accountRefs.filter(
    (account) => platform === "all" || account.platform === platform,
  );
  const selectedAccountId =
    params.account && visibleRefs.some((account) => account.id === params.account)
      ? params.account
      : undefined;

  const supabase = createAdminClient();
  const result = await listOperationalErrors(supabase, ownerId, {
    severity: (params.severity as OperationalErrorSeverity | "all") ?? "all",
    status: (params.status as OperationalErrorStatus | "all" | "open_active") ?? "open_active",
    category: (params.category as OperationalErrorCategory | "all") ?? "all",
    accountId: selectedAccountId,
    platform: platform === "all" ? undefined : platform,
    q: params.q,
  });

  return (
    <ErrorCenter
      errors={result.errors}
      summary={result.summary}
      syncedAt={result.syncedAt}
      accounts={accountRefs}
      filters={{
        severity: params.severity ?? "all",
        status: params.status ?? "open_active",
        category: params.category ?? "all",
        accountId: selectedAccountId,
        platform,
        q: params.q,
      }}
    />
  );
}
