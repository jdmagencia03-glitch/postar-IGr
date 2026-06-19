import { formatZodError } from "@/lib/api-errors";
import { BATCH_CREATE_CHUNK_SIZE, MAX_VIDEOS_TOTAL } from "@/lib/autopilot-constants";
import {
  mergeUploadFilesIntoBatch,
  refreshBatchCounters,
} from "@/lib/upload/batches";
import { getSessionUserId } from "@/lib/meta/oauth";
import { createAdminClient } from "@/lib/supabase/admin";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const appendSchema = z.object({
  files: z
    .array(
      z.object({
        filename: z.string().min(1).max(500),
        file_size: z.number().int().positive(),
        content_type: z.string().max(120).optional(),
        file_hash: z.string().max(500).optional(),
        last_modified: z.number().int().optional(),
      }),
    )
    .min(1)
    .max(BATCH_CREATE_CHUNK_SIZE, {
      message: `Envie no máximo ${BATCH_CREATE_CHUNK_SIZE} vídeos por requisição.`,
    }),
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
  const parsed = appendSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
  }

  const supabase = createAdminClient();

  const [{ data: batch }, { count: existingCount }, { data: lastFile }] = await Promise.all([
    supabase
      .from("upload_batches")
      .select("id, status, total_files")
      .eq("id", id)
      .eq("owner_id", ownerId)
      .maybeSingle(),
    supabase
      .from("upload_files")
      .select("id", { count: "exact", head: true })
      .eq("batch_id", id),
    supabase
      .from("upload_files")
      .select("sort_order")
      .eq("batch_id", id)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (!batch) {
    return NextResponse.json({ error: "Lote não encontrado" }, { status: 404 });
  }

  if (batch.status !== "uploading") {
    return NextResponse.json({ error: "Este lote não aceita novos arquivos." }, { status: 409 });
  }

  const currentCount = existingCount ?? batch.total_files ?? 0;
  const nextTotal = currentCount + parsed.data.files.length;

  if (nextTotal > MAX_VIDEOS_TOTAL) {
    return NextResponse.json(
      {
        error: `Limite de ${MAX_VIDEOS_TOTAL} vídeos por lote. Você já tem ${currentCount} e tentou adicionar ${parsed.data.files.length}.`,
      },
      { status: 400 },
    );
  }

  const sortOrderOffset = lastFile?.sort_order ?? -1;

  try {
    const { added: files, skipped } = await mergeUploadFilesIntoBatch(
      supabase,
      ownerId,
      batch.id,
      parsed.data.files,
      sortOrderOffset + 1,
    );
    const counters = await refreshBatchCounters(supabase, batch.id);

    return NextResponse.json({
      added: files,
      skipped,
      counters,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao adicionar arquivos" },
      { status: 500 },
    );
  }
}
