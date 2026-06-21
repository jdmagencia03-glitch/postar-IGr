import { redirect } from "next/navigation";
import { PlatformAuditPanel } from "@/components/operations/PlatformAuditPanel";
import { requirePlatformAdmin } from "@/lib/admin/gate";
import { getSessionUserId } from "@/lib/meta/oauth";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export default async function PlatformAuditPage() {
  const ownerId = await getSessionUserId();
  if (!ownerId) redirect("/login?next=/dashboard/operations/audit");

  const supabase = createAdminClient();
  const gate = await requirePlatformAdmin(supabase, ownerId);
  if (!gate.ok) redirect("/dashboard/reports");

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <PlatformAuditPanel />
    </div>
  );
}
