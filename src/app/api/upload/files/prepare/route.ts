import { formatZodError } from "@/lib/api-errors";
import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/meta/oauth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTusSignedEndpoint, TUS_CHUNK_SIZE } from "@/lib/upload/storage-url";
import { logAccessDenied, logSecurityEvent } from "@/lib/security/audit";
import {
  assertOwnerStoragePath,
  validateUploadMetadata,
} from "@/lib/security/ownership";
import { z } from "zod";

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
    return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
  }

  const validation = validateUploadMetadata({
    filename: parsed.data.name,
    size: parsed.data.size,
    contentType: parsed.data.type,
  });

  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
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
    await logAccessDenied({
      ownerId,
      resourceType: "upload_batch",
      resourceId: parsed.data.batch_id,
      request,
      reason: "batch_not_owned",
    });
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

  if (parsed.data.storage_path !== file.storage_path) {
    await logAccessDenied({
      ownerId,
      resourceType: "upload_file",
      resourceId: parsed.data.file_id,
      request,
      reason: "storage_path_mismatch",
    });
    return NextResponse.json({ error: "Caminho de upload inválido" }, { status: 403 });
  }

  const pathCheck = assertOwnerStoragePath(ownerId, file.storage_path);
  if (!pathCheck.ok) {
    return NextResponse.json({ error: pathCheck.error }, { status: 403 });
  }

  const path = pathCheck.path;
  const { data, error } = await supabase.storage.from("media").createSignedUploadUrl(path, {
    upsert: true,
  });

  if (error || !data) {
    const raw = error?.message ?? "Falha ao preparar upload";
    const friendly =
      /size|limit|50|413|payload too large/i.test(raw)
        ? "Arquivo excede o limite do bucket Supabase. Execute supabase/storage-pro.sql no SQL Editor (limite recomendado: 1 GB)."
        : raw;
    return NextResponse.json({ error: friendly }, { status: 500 });
  }

  const { data: publicData } = supabase.storage.from("media").getPublicUrl(path);

  await logSecurityEvent({
    ownerId,
    eventType: "upload_prepared",
    resourceType: "upload_file",
    resourceId: file.id,
    ipAddress: request.headers.get("x-forwarded-for"),
    userAgent: request.headers.get("user-agent"),
    metadata: { batchId: batch.id, path },
  });

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
