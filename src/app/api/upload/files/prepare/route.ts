import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/meta/oauth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTusSignedEndpoint, TUS_CHUNK_SIZE } from "@/lib/upload/storage-url";
import { z } from "zod";

const MAX_FILE_SIZE = 500 * 1024 * 1024;

const prepareSchema = z.object({
  batch_id: z.string().uuid(),
  file_id: z.string().uuid(),
  storage_path: z.string().min(1),
  name: z.string().min(1),
  type: z.string().optional(),
  size: z.number().int().positive(),
});

export async function POST(request: NextRequest) {
  const ownerId = await getSessionUserId();
  if (!ownerId) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const body = await request.json();
  const parsed = prepareSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  if (parsed.data.size > MAX_FILE_SIZE) {
    return NextResponse.json(
      { error: `${parsed.data.name} é muito grande. Máximo: 500MB.` },
      { status: 400 },
    );
  }

  const supabase = createAdminClient();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

  if (!supabaseUrl) {
    return NextResponse.json({ error: "Supabase não configurado" }, { status: 500 });
  }

  const { data: batch } = await supabase
    .from("upload_batches")
    .select("id")
    .eq("id", parsed.data.batch_id)
    .eq("owner_id", ownerId)
    .maybeSingle();

  if (!batch) {
    return NextResponse.json({ error: "Lote não encontrado" }, { status: 404 });
  }

  const { data: file } = await supabase
    .from("upload_files")
    .select("*")
    .eq("id", parsed.data.file_id)
    .eq("batch_id", parsed.data.batch_id)
    .maybeSingle();

  if (!file) {
    return NextResponse.json({ error: "Arquivo não encontrado no lote" }, { status: 404 });
  }

  const path = parsed.data.storage_path;
  const { data, error } = await supabase.storage.from("media").createSignedUploadUrl(path, {
    upsert: true,
  });

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "Falha ao preparar upload" }, { status: 500 });
  }

  const { data: publicData } = supabase.storage.from("media").getPublicUrl(path);

  return NextResponse.json({
    tusEndpoint: getTusSignedEndpoint(supabaseUrl),
    signature: data.token,
    path,
    publicUrl: publicData.publicUrl,
    contentType: parsed.data.type || file.content_type || "video/mp4",
    chunkSize: TUS_CHUNK_SIZE,
    fileId: file.id,
    batchId: batch.id,
    signedUrl: data.signedUrl,
  });
}
