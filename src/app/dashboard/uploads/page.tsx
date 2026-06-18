import { redirect } from "next/navigation";
import { UploadBatchHistoryList } from "@/components/uploads/UploadBatchHistoryList";
import { getSessionUserId } from "@/lib/meta/oauth";
import { listBatchHistoryForOwner } from "@/lib/upload/batches";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export default async function UploadsHistoryPage() {
  const ownerId = await getSessionUserId();
  if (!ownerId) redirect("/login?next=/dashboard/uploads");

  const supabase = createAdminClient();
  const batches = await listBatchHistoryForOwner(supabase, ownerId, 50);

  return (
    <>
      <header className="ig-page-header">
        <h1>Histórico de uploads</h1>
        <p>Lotes enviados, status, falhas e duração.</p>
      </header>
      <UploadBatchHistoryList batches={batches} />
    </>
  );
}
