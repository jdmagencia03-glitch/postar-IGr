import { redirect, notFound } from "next/navigation";
import { UploadBatchDetailView } from "@/components/uploads/UploadBatchDetailView";
import { getSessionUserId } from "@/lib/meta/oauth";
import { getBatchForOwner } from "@/lib/upload/batches";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export default async function UploadBatchDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const ownerId = await getSessionUserId();
  if (!ownerId) redirect("/login?next=/dashboard/uploads");

  const { id } = await params;
  const supabase = createAdminClient();
  const batch = await getBatchForOwner(supabase, ownerId, id);

  if (!batch) notFound();

  return (
    <>
      <header className="ig-page-header">
        <h1>Detalhe do lote</h1>
        <p>Arquivos, falhas e ações do upload em lote.</p>
      </header>
      <UploadBatchDetailView batch={batch} />
    </>
  );
}
