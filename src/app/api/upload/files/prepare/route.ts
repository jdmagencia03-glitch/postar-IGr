import { formatZodError } from "@/lib/api-errors";
import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/meta/oauth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTusSignedEndpoint } from "@/lib/upload/storage-url";
import { logAccessDenied, logSecurityEvent } from "@/lib/security/audit";
import {
  assertOwnerStoragePath,
  formatMaxUploadSize,
  validateUploadMetadata,
} from "@/lib/security/ownership";
import {
  buildBunnyCdnUrl,
  buildBunnyStorageApiUrl,
  getBunnyMediaBackend,
  getBunnyStorageConfig,
  getMediaStorageProvider,
} from "@/lib/storage/bunny";
import {
  createBunnyStreamVideo,
  prepareBunnyStreamUpload,
} from "@/lib/storage/bunny-stream";
import { TUS_CHUNK_SIZE } from "@/lib/upload/storage-config";
import { formatBytes } from "@/lib/upload/validate";
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

  const provider = getMediaStorageProvider();
  const bunnyBackend = getBunnyMediaBackend();
  const bunnyStorage = getBunnyStorageConfig();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

  if (provider === "bunny" && bunnyBackend === "none") {
    return NextResponse.json(
      {
        error:
          "Bunny não configurado. Defina BUNNY_STREAM_LIBRARY_ID + BUNNY_STREAM_API_KEY + BUNNY_STREAM_CDN_HOSTNAME (recomendado) ou variáveis de Bunny Storage.",
      },
      { status: 500 },
    );
  }

  if (provider === "supabase" && !supabaseUrl) {
    return NextResponse.json({ error: "Supabase não configurado" }, { status: 500 });
  }

  const supabase = createAdminClient();

  const { data: batch } = await supabase
    .from("upload_batches")
    .select("id, status")
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

  if (batch.status === "cancelled" || batch.status === "scheduled") {
    return NextResponse.json({ error: "Este lote não aceita novos uploads." }, { status: 409 });
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

  if (file.status === "completed" && file.public_url) {
    return NextResponse.json({ error: "Arquivo já foi enviado." }, { status: 409 });
  }

  if (file.removed) {
    return NextResponse.json({ error: "Arquivo removido do lote." }, { status: 409 });
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

  if (provider === "supabase") {
    const { data: bucketInfo } = await supabase.storage.getBucket("media");
    const bucketLimit = bucketInfo?.file_size_limit ?? 0;
    if (bucketLimit > 0 && parsed.data.size > bucketLimit) {
      return NextResponse.json(
        {
          error: `Arquivo (${formatBytes(parsed.data.size)}) excede o limite do bucket media (${formatBytes(bucketLimit)}).`,
        },
        { status: 400 },
      );
    }
  }

  await supabase
    .from("upload_files")
    .update({
      status: "uploading",
      updated_at: new Date().toISOString(),
    })
    .eq("id", file.id)
    .eq("batch_id", batch.id);

  const contentType = parsed.data.type || file.content_type || "video/mp4";

  if (provider === "bunny" && bunnyBackend === "stream") {
    try {
      const videoTitle = `${path}::${file.id}`;
      const videoId = await createBunnyStreamVideo(videoTitle);
      const stream = prepareBunnyStreamUpload({
        videoId,
        title: parsed.data.name,
      });

      void logSecurityEvent({
        ownerId,
        eventType: "upload_prepared",
        resourceType: "upload_file",
        resourceId: file.id,
        ipAddress: request.headers.get("x-forwarded-for"),
        userAgent: request.headers.get("user-agent"),
        metadata: { batchId: batch.id, path, provider: "bunny-stream", videoId },
      });

      return NextResponse.json({
        provider: "bunny-stream",
        tusEndpoint: stream.tusEndpoint,
        libraryId: stream.libraryId,
        videoId: stream.videoId,
        authorizationSignature: stream.authorizationSignature,
        authorizationExpire: stream.authorizationExpire,
        path,
        publicUrl: stream.publicUrl,
        contentType,
        chunkSize: TUS_CHUNK_SIZE,
        fileId: file.id,
        batchId: batch.id,
      });
    } catch (error) {
      return NextResponse.json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Falha ao preparar upload no Bunny Stream",
        },
        { status: 500 },
      );
    }
  }

  if (provider === "bunny" && bunnyBackend === "storage" && bunnyStorage) {
    const uploadUrl = buildBunnyStorageApiUrl(path, bunnyStorage);
    const publicUrl = buildBunnyCdnUrl(path, bunnyStorage);

    if (!uploadUrl || !publicUrl) {
      return NextResponse.json({ error: "Falha ao montar URLs do Bunny Storage" }, { status: 500 });
    }

    void logSecurityEvent({
      ownerId,
      eventType: "upload_prepared",
      resourceType: "upload_file",
      resourceId: file.id,
      ipAddress: request.headers.get("x-forwarded-for"),
      userAgent: request.headers.get("user-agent"),
      metadata: { batchId: batch.id, path, provider: "bunny-storage" },
    });

    return NextResponse.json({
      provider: "bunny-storage",
      uploadUrl,
      accessKey: bunnyStorage.accessKey,
      path,
      publicUrl,
      contentType,
      fileId: file.id,
      batchId: batch.id,
    });
  }

  const { data, error } = await supabase.storage.from("media").createSignedUploadUrl(path, {
    upsert: true,
  });

  if (error || !data) {
    const raw = error?.message ?? "Falha ao preparar upload";
    const friendly =
      /413|payload too large|entity too large|maximum allowed size|file_size_limit|object exceeded/i.test(
        raw,
      )
        ? `Arquivo excede o limite do bucket Supabase (${formatMaxUploadSize()}). Detalhe: ${raw}`
        : raw;
    return NextResponse.json({ error: friendly }, { status: 500 });
  }

  const { data: publicData } = supabase.storage.from("media").getPublicUrl(path);

  void logSecurityEvent({
    ownerId,
    eventType: "upload_prepared",
    resourceType: "upload_file",
    resourceId: file.id,
    ipAddress: request.headers.get("x-forwarded-for"),
    userAgent: request.headers.get("user-agent"),
    metadata: { batchId: batch.id, path, provider: "supabase" },
  });

  return NextResponse.json({
    provider: "supabase",
    tusEndpoint: getTusSignedEndpoint(supabaseUrl!),
    signature: data.token,
    path,
    publicUrl: publicData.publicUrl,
    contentType,
    chunkSize: TUS_CHUNK_SIZE,
    fileId: file.id,
    batchId: batch.id,
    signedUrl: data.signedUrl,
  });
}
