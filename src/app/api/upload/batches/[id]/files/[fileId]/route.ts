import { formatZodError } from "@/lib/api-errors";
import { NextRequest, NextResponse } from "next/server";
import { updateUploadFileStatus, verifyBatchFileAccess } from "@/lib/upload/batches";
import { releaseUploadFileLease, renewUploadFileLease } from "@/lib/upload/queue";
import { getSessionUserId } from "@/lib/meta/oauth";
import { createAdminClient } from "@/lib/supabase/admin";
import { z } from "zod";

const patchSchema = z.object({
  status: z.enum(["pending", "uploading", "retrying", "stalled", "completed", "failed"]),
  public_url: z.string().url().optional().nullable(),
  bytes_uploaded: z.number().int().min(0).optional(),
  error_message: z.string().max(2000).optional().nullable(),
  worker_id: z.string().optional(),
  attempt_count: z.number().int().min(0).optional(),
});

function isProgressOnlyUpdate(body: z.infer<typeof patchSchema>) {
  return (
    (body.status === "uploading" || body.status === "retrying") &&
    body.bytes_uploaded !== undefined &&
    !body.public_url
  );
}

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
  const access = await verifyBatchFileAccess(supabase, ownerId, id, fileId);

  if (!access) {
    return NextResponse.json({ error: "Arquivo não encontrado" }, { status: 404 });
  }

  if (access.batch.status === "cancelled") {
    return NextResponse.json({ error: "Lote cancelado" }, { status: 409 });
  }

  try {
    const progressOnly = isProgressOnlyUpdate(parsed.data);

    if (
      progressOnly &&
      parsed.data.worker_id &&
      parsed.data.bytes_uploaded !== undefined
    ) {
      const file = await renewUploadFileLease(supabase, {
        batchId: id,
        fileId,
        workerId: parsed.data.worker_id,
        bytesUploaded: parsed.data.bytes_uploaded,
      });
      return NextResponse.json({ file, counters: null });
    }

    if (
      parsed.data.status === "completed" ||
      parsed.data.status === "failed"
    ) {
      if (parsed.data.status === "completed") {
        if (!parsed.data.public_url) {
          return NextResponse.json(
            { error: "public_url obrigatório para concluir upload.", code: "upload_incomplete" },
            { status: 400 },
          );
        }

        const { validateMediaAssetFromUrl } = await import("@/lib/media/assets");
        const validation = await validateMediaAssetFromUrl({
          supabase,
          ownerId,
          videoUrl: parsed.data.public_url,
          uploadFileId: fileId,
          fileHash: null,
        });

        if (!validation.ok) {
          return NextResponse.json(
            {
              error: validation.message,
              code: validation.code,
              action: validation.action,
            },
            { status: 400 },
          );
        }
      }

      const { file, counters } = await releaseUploadFileLease(supabase, {
        batchId: id,
        fileId,
        status: parsed.data.status,
        workerId: parsed.data.worker_id,
        publicUrl: parsed.data.public_url,
        bytesUploaded: parsed.data.bytes_uploaded,
        errorMessage: parsed.data.error_message,
        attemptCount: parsed.data.attempt_count,
        refreshCounters: !progressOnly,
      });
      return NextResponse.json({ file, counters: counters ?? null });
    }

    const { file, counters } = await updateUploadFileStatus(supabase, {
      batchId: id,
      fileId,
      status: parsed.data.status,
      publicUrl: parsed.data.public_url,
      bytesUploaded: parsed.data.bytes_uploaded,
      errorMessage: parsed.data.error_message,
      refreshCounters: !progressOnly,
    });

    return NextResponse.json({ file, counters: counters ?? null });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao atualizar arquivo" },
      { status: 500 },
    );
  }
}
