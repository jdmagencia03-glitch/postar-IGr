import type { SupabaseClient } from "@supabase/supabase-js";
import { getInstagramAccountForAdmin } from "@/lib/instagram/admin-gate";
import {
  buildPublicMediaUrl,
  getStorageObjectMeta,
  parseMediaPublicUrl,
  probeHttpMediaUrl,
  type HttpMediaProbe,
} from "@/lib/storage/media-url-validation";

export type AlternateObjectMatch = {
  path: string;
  publicUrl: string;
  size: number | null;
  mimeType: string | null;
  httpStatus: number | null;
  contentType: string | null;
  source: "upload_files" | "storage_list";
  uploadFileId: string | null;
  uploadFileStatus: string | null;
  batchId: string | null;
};

export type UrlOriginTrace = {
  scheduledPost: {
    id: string;
    status: string;
    uploadBatchId: string | null;
    mediaUrls: string[];
    errorMessage: string | null;
    mediaCleanedAt: string | null;
  } | null;
  uploadFile: {
    id: string;
    batchId: string;
    filename: string;
    storagePath: string;
    publicUrl: string | null;
    status: string;
    removed: boolean | null;
    bytesUploaded: number | null;
    fileSize: number | null;
    completedAt: string | null;
  } | null;
  uploadBatch: {
    id: string;
    status: string;
    ownerId: string;
    accountId: string | null;
    createdAt: string;
  } | null;
  scheduleJobItems: Array<{
    id: string;
    scheduleJobId: string;
    status: string;
    uploadFileId: string | null;
    filename: string;
  }>;
  originHypotheses: string[];
};

export type VideoUrlAuditItem = {
  postId: string;
  status: string;
  videoUrl: string;
  httpStatus: number | null;
  contentType: string | null;
  responseBodyPreview: string | null;
  contentLength: number | null;
  storageBucket: string;
  storageObjectPathFromUrl: string | null;
  storageObjectExists: boolean;
  storageObjectSize: number | null;
  storageObjectMimeType: string | null;
  fileName: string | null;
  matchedAlternateObjects: AlternateObjectMatch[];
  probableCause:
    | "storage_object_missing"
    | "storage_object_deleted_after_schedule"
    | "upload_marked_complete_without_object"
    | "post_scheduled_before_upload_finished"
    | "unknown";
  originTrace: UrlOriginTrace;
};

async function probeAlternatePath(
  supabase: SupabaseClient,
  storagePath: string,
  meta: {
    source: AlternateObjectMatch["source"];
    uploadFileId: string | null;
    uploadFileStatus: string | null;
    batchId: string | null;
  },
): Promise<AlternateObjectMatch | null> {
  const storage = await getStorageObjectMeta(supabase, storagePath);
  if (!storage.exists) return null;

  const publicUrl = buildPublicMediaUrl(storagePath);
  if (!publicUrl) return null;

  const http = await probeHttpMediaUrl(publicUrl);
  if (!http.accessible && !http.isVideoContentType) return null;

  return {
    path: storagePath,
    publicUrl,
    size: storage.size,
    mimeType: storage.mimeType,
    httpStatus: http.httpStatus,
    contentType: http.contentType,
    source: meta.source,
    uploadFileId: meta.uploadFileId,
    uploadFileStatus: meta.uploadFileStatus,
    batchId: meta.batchId,
  };
}

async function findAlternateObjects(params: {
  supabase: SupabaseClient;
  ownerId: string;
  fileName: string | null;
  uploadFileIdFromPath: string | null;
  batchIdFromPath: string | null;
  originalPath: string | null;
}) {
  const matches: AlternateObjectMatch[] = [];
  const seenPaths = new Set<string>();

  const pushMatch = (match: AlternateObjectMatch | null) => {
    if (!match || seenPaths.has(match.path) || match.path === params.originalPath) return;
    seenPaths.add(match.path);
    matches.push(match);
  };

  if (params.uploadFileIdFromPath) {
    const { data: byId } = await params.supabase
      .from("upload_files")
      .select("id, batch_id, storage_path, public_url, status, removed, filename")
      .eq("id", params.uploadFileIdFromPath)
      .maybeSingle();

    if (byId?.storage_path) {
      pushMatch(
        await probeAlternatePath(params.supabase, byId.storage_path, {
          source: "upload_files",
          uploadFileId: byId.id,
          uploadFileStatus: byId.status,
          batchId: byId.batch_id,
        }),
      );
    }
  }

  if (params.fileName) {
    const { data: batches } = await params.supabase
      .from("upload_batches")
      .select("id")
      .eq("owner_id", params.ownerId)
      .limit(200);

    const batchIds = (batches ?? []).map((b) => b.id);
    if (batchIds.length) {
      const { data: files } = await params.supabase
        .from("upload_files")
        .select("id, batch_id, storage_path, public_url, status, removed, filename")
        .in("batch_id", batchIds)
        .ilike("storage_path", `%${params.fileName}%`)
        .limit(50);

      for (const file of files ?? []) {
        if (!file.storage_path || file.storage_path === params.originalPath) continue;
        pushMatch(
          await probeAlternatePath(params.supabase, file.storage_path, {
            source: "upload_files",
            uploadFileId: file.id,
            uploadFileStatus: file.status,
            batchId: file.batch_id,
          }),
        );
      }
    }
  }

  if (params.batchIdFromPath && params.fileName) {
    const folder = `${params.ownerId}/${params.batchIdFromPath}`;
    const { data: listed } = await params.supabase.storage.from("media").list(folder, { limit: 1000 });
    for (const item of listed ?? []) {
      if (!item.id || item.name === params.fileName) continue;
      const path = `${folder}/${item.name}`;
      pushMatch(
        await probeAlternatePath(params.supabase, path, {
          source: "storage_list",
          uploadFileId: null,
          uploadFileStatus: null,
          batchId: params.batchIdFromPath,
        }),
      );
    }
  }

  return matches;
}

function inferProbableCause(params: {
  storageExists: boolean;
  httpProbe: HttpMediaProbe;
  origin: UrlOriginTrace;
}): VideoUrlAuditItem["probableCause"] {
  if (params.storageExists && params.httpProbe.accessible) {
    return "unknown";
  }

  if (params.origin.uploadFile?.removed) {
    return "storage_object_deleted_after_schedule";
  }

  if (
    params.origin.uploadFile?.status === "completed" &&
    !params.storageExists
  ) {
    return "upload_marked_complete_without_object";
  }

  if (
    params.origin.uploadFile &&
    params.origin.uploadFile.status !== "completed" &&
    params.origin.scheduledPost
  ) {
    return "post_scheduled_before_upload_finished";
  }

  if (!params.storageExists || params.httpProbe.looksLikeStorageErrorJson) {
    return "storage_object_missing";
  }

  return "unknown";
}

function buildOriginHypotheses(origin: UrlOriginTrace): string[] {
  const hypotheses: string[] = [];

  if (!origin.uploadFile) {
    hypotheses.push("Nenhum registro upload_files corresponde ao fileId/path da URL.");
  } else {
    if (origin.uploadFile.status === "completed" && !origin.uploadFile.removed) {
      hypotheses.push(
        "upload_files marcado como completed, mas objeto ausente no Storage — upload incompleto ou arquivo removido manualmente.",
      );
    }
    if (origin.uploadFile.status !== "completed") {
      hypotheses.push(
        `upload_files ainda em status ${origin.uploadFile.status} — post pode ter sido agendado antes do upload terminar.`,
      );
    }
    if (origin.uploadFile.removed) {
      hypotheses.push("upload_files.removed=true — arquivo foi descartado após agendamento ou limpeza de conta.");
    }
  }

  if (origin.uploadBatch?.status === "cancelled") {
    hypotheses.push(
      "Lote cancelado — possível limpeza de vídeos da conta (clear-videos) que removeu objetos do Storage.",
    );
  }

  if (origin.scheduledPost?.mediaCleanedAt) {
    hypotheses.push("Post teve media_cleaned_at — limpeza pós-publicação (não deveria afetar posts failed).");
  }

  if (!hypotheses.length) {
    hypotheses.push("Objeto ausente no Storage; origem exata requer correlacionar upload_files + logs do lote.");
  }

  return hypotheses;
}

async function traceUrlOrigin(params: {
  supabase: SupabaseClient;
  postId: string;
  videoUrl: string;
  parsed: ReturnType<typeof parseMediaPublicUrl>;
}): Promise<UrlOriginTrace> {
  const { data: post } = await params.supabase
    .from("scheduled_posts")
    .select("id, status, upload_batch_id, media_urls, error_message, media_cleaned_at")
    .eq("id", params.postId)
    .maybeSingle();

  let uploadFile: UrlOriginTrace["uploadFile"] = null;
  let uploadBatch: UrlOriginTrace["uploadBatch"] = null;

  if (params.parsed.uploadFileIdFromPath) {
    const { data: file } = await params.supabase
      .from("upload_files")
      .select(
        "id, batch_id, filename, storage_path, public_url, status, removed, bytes_uploaded, file_size",
      )
      .eq("id", params.parsed.uploadFileIdFromPath)
      .maybeSingle();

    if (file) {
      uploadFile = {
        id: file.id,
        batchId: file.batch_id,
        filename: file.filename,
        storagePath: file.storage_path,
        publicUrl: file.public_url,
        status: file.status,
        removed: file.removed ?? null,
        bytesUploaded: file.bytes_uploaded ?? null,
        fileSize: file.file_size ?? null,
        completedAt: null,
      };

      const { data: batch } = await params.supabase
        .from("upload_batches")
        .select("id, status, owner_id, account_id, created_at")
        .eq("id", file.batch_id)
        .maybeSingle();

      if (batch) {
        uploadBatch = {
          id: batch.id,
          status: batch.status,
          ownerId: batch.owner_id,
          accountId: batch.account_id,
          createdAt: batch.created_at,
        };
      }
    }
  } else if (params.parsed.batchIdFromPath) {
    const { data: batch } = await params.supabase
      .from("upload_batches")
      .select("id, status, owner_id, account_id, created_at")
      .eq("id", params.parsed.batchIdFromPath)
      .maybeSingle();

    if (batch) {
      uploadBatch = {
        id: batch.id,
        status: batch.status,
        ownerId: batch.owner_id,
        accountId: batch.account_id,
        createdAt: batch.created_at,
      };
    }
  }

  const jobItems: UrlOriginTrace["scheduleJobItems"] = [];

  if (params.parsed.uploadFileIdFromPath) {
    const { data: byFile } = await params.supabase
      .from("schedule_job_items")
      .select("id, schedule_job_id, status, upload_file_id, filename")
      .eq("upload_file_id", params.parsed.uploadFileIdFromPath)
      .limit(10);
    for (const item of byFile ?? []) {
      jobItems.push({
        id: item.id,
        scheduleJobId: item.schedule_job_id,
        status: item.status,
        uploadFileId: item.upload_file_id,
        filename: item.filename,
      });
    }
  }

  const { data: byPost } = await params.supabase
    .from("schedule_job_items")
    .select("id, schedule_job_id, status, upload_file_id, filename")
    .eq("created_post_id", params.postId)
    .limit(5);

  for (const item of byPost ?? []) {
    if (jobItems.some((existing) => existing.id === item.id)) continue;
    jobItems.push({
      id: item.id,
      scheduleJobId: item.schedule_job_id,
      status: item.status,
      uploadFileId: item.upload_file_id,
      filename: item.filename,
    });
  }

  const origin: UrlOriginTrace = {
    scheduledPost: post
      ? {
          id: post.id,
          status: post.status,
          uploadBatchId: post.upload_batch_id,
          mediaUrls: post.media_urls ?? [],
          errorMessage: post.error_message,
          mediaCleanedAt: post.media_cleaned_at ?? null,
        }
      : null,
    uploadFile,
    uploadBatch,
    scheduleJobItems: jobItems,
    originHypotheses: [],
  };

  origin.originHypotheses = buildOriginHypotheses(origin);
  return origin;
}

export async function buildInstagramVideoUrlAudit(params: {
  supabase: SupabaseClient;
  ownerId: string;
  accountId: string;
  limit?: number;
}) {
  const account = await getInstagramAccountForAdmin(
    params.supabase,
    params.ownerId,
    params.accountId,
  );

  if (!account) {
    return { ok: false as const, error: "account_not_found" as const };
  }

  const limit = Math.min(Math.max(params.limit ?? 20, 1), 50);

  const { data: posts, error } = await params.supabase
    .from("scheduled_posts")
    .select("id, status, media_urls, upload_batch_id")
    .eq("account_id", params.accountId)
    .in("status", ["failed_persistent", "retrying"])
    .order("scheduled_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(error.message);
  }

  const items: VideoUrlAuditItem[] = [];

  for (const post of posts ?? []) {
    const videoUrl = post.media_urls?.[0] ?? "";
    if (!videoUrl) continue;

    const parsed = parseMediaPublicUrl(videoUrl);
    const httpProbe = await probeHttpMediaUrl(videoUrl);
    const storageMeta = parsed.storageObjectPathFromUrl
      ? await getStorageObjectMeta(params.supabase, parsed.storageObjectPathFromUrl)
      : { exists: false, size: null, mimeType: null, error: "invalid_url" };

    const originTrace = await traceUrlOrigin({
      supabase: params.supabase,
      postId: post.id,
      videoUrl,
      parsed,
    });

    const matchedAlternateObjects = await findAlternateObjects({
      supabase: params.supabase,
      ownerId: params.ownerId,
      fileName: parsed.fileName,
      uploadFileIdFromPath: parsed.uploadFileIdFromPath,
      batchIdFromPath: parsed.batchIdFromPath,
      originalPath: parsed.storageObjectPathFromUrl,
    });

    items.push({
      postId: post.id,
      status: post.status,
      videoUrl,
      httpStatus: httpProbe.httpStatus,
      contentType: httpProbe.contentType,
      responseBodyPreview: httpProbe.responseBodyPreview,
      contentLength: httpProbe.contentLength,
      storageBucket: parsed.storageBucket,
      storageObjectPathFromUrl: parsed.storageObjectPathFromUrl,
      storageObjectExists: storageMeta.exists,
      storageObjectSize: storageMeta.size,
      storageObjectMimeType: storageMeta.mimeType,
      fileName: parsed.fileName,
      matchedAlternateObjects,
      probableCause: inferProbableCause({
        storageExists: storageMeta.exists,
        httpProbe,
        origin: originTrace,
      }),
      originTrace,
    });
  }

  return {
    ok: true as const,
    ownerId: params.ownerId,
    accountId: params.accountId,
    account: account.ig_username ? `@${account.ig_username.replace(/^@/, "")}` : params.accountId,
    count: items.length,
    posts: items,
    summary: {
      missingStorage: items.filter((item) => !item.storageObjectExists).length,
      withAlternates: items.filter((item) => item.matchedAlternateObjects.length > 0).length,
    },
  };
}
