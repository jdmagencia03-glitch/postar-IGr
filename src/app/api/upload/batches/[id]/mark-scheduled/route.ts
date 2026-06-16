import { NextRequest, NextResponse } from "next/server";
import { getBatchForOwner, refreshBatchCounters } from "@/lib/upload/batches";
import { getSessionUserId } from "@/lib/meta/oauth";
import { createAdminClient } from "@/lib/supabase/admin";
import { z } from "zod";
import { formatZodError } from "@/lib/api-errors";

const bodySchema = z.object({
  public_urls: z.array(z.string().url()).min(1),
});

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const ownerId = await getSessionUserId();
  if (!ownerId) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const { id } = await context.params;
  const body = await request.json();
  const parsed = bodySchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
  }

  const supabase = createAdminClient();
  const batch = await getBatchForOwner(supabase, ownerId, id);

  if (!batch) {
    return NextResponse.json({ error: "Lote não encontrado" }, { status: 404 });
  }

  const urlSet = new Set(parsed.data.public_urls);
  const fileIds =
    batch.upload_files
      ?.filter((file) => file.public_url && urlSet.has(file.public_url))
      .map((file) => file.id) ?? [];

  if (!fileIds.length) {
    return NextResponse.json({ error: "Nenhum arquivo correspondente encontrado" }, { status: 404 });
  }

  const { error } = await supabase
    .from("upload_files")
    .update({ removed: true, updated_at: new Date().toISOString() })
    .in("id", fileIds)
    .eq("batch_id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await refreshBatchCounters(supabase, id);
  const updatedBatch = await getBatchForOwner(supabase, ownerId, id);

  return NextResponse.json({ batch: updatedBatch, marked: fileIds.length });
}
