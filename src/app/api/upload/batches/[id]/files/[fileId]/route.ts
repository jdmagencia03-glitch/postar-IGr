import { formatZodError } from "@/lib/api-errors";
import { NextRequest, NextResponse } from "next/server";
import { getBatchForOwner, updateUploadFileStatus } from "@/lib/upload/batches";
import { getSessionUserId } from "@/lib/meta/oauth";
import { createAdminClient } from "@/lib/supabase/admin";
import { z } from "zod";

const patchSchema = z.object({
  status: z.enum(["pending", "uploading", "completed", "failed"]),
  public_url: z.string().url().optional().nullable(),
  bytes_uploaded: z.number().int().min(0).optional(),
  error_message: z.string().max(2000).optional().nullable(),
});

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string; fileId: string }> },
) {
  const ownerId = await getSessionUserId();
  if (!ownerId) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const { id, fileId } = await context.params;
  const body = await request.json();
  const parsed = patchSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
  }

  const supabase = createAdminClient();
  const batch = await getBatchForOwner(supabase, ownerId, id);

  if (!batch) {
    return NextResponse.json({ error: "Lote não encontrado" }, { status: 404 });
  }

  if (batch.status === "cancelled") {
    return NextResponse.json({ error: "Lote cancelado" }, { status: 409 });
  }

  const file = batch.upload_files?.find((item) => item.id === fileId);
  if (!file) {
    return NextResponse.json({ error: "Arquivo não encontrado" }, { status: 404 });
  }

  try {
    const counters = await updateUploadFileStatus(supabase, {
      batchId: id,
      fileId,
      status: parsed.data.status,
      publicUrl: parsed.data.public_url,
      bytesUploaded: parsed.data.bytes_uploaded,
      errorMessage: parsed.data.error_message,
    });

    const updatedBatch = await getBatchForOwner(supabase, ownerId, id);
    return NextResponse.json({ batch: updatedBatch, counters });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao atualizar arquivo" },
      { status: 500 },
    );
  }
}
